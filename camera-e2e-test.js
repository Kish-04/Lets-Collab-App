const mongoose = require('./server/node_modules/mongoose');
const jwt = require('./server/node_modules/jsonwebtoken');
const puppeteer = require('puppeteer');

const JWT_SECRET = 'super_secret_test_key_for_jwt';
const FRONT = 'http://localhost:3000';
const MONGO_URI = 'mongodb://127.0.0.1:27017/ircp_db';
const HOST = { name: 'E2E Host', email: 'e2e.host@test.com' };
const CTRL = { name: 'E2E Controller', email: 'e2e.ctrl@test.com' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seedUsers() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 4000 });
  const User = mongoose.model('User', new mongoose.Schema({
    name: String, email: { type: String, unique: true }, password: String,
    isVerified: Boolean, role: String, banned: Boolean,
  }, { timestamps: true }));
  async function upsert(u) {
    const e = await User.findOne({ email: u.email });
    if (e) return e._id.toString();
    const d = new User({ name: u.name, email: u.email, password: 'E2EPass123!', isVerified: true, role: 'user', banned: false });
    await d.save();
    return d._id.toString();
  }
  return { hostId: await upsert(HOST), ctrlId: await upsert(CTRL) };
}
const tokenFor = (id, email) => jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '30d' });

// Robust eval that retries across HMR reloads / context destruction
async function reval(page, fn, tries = 60, delay = 300, ...args) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await page.evaluate(fn, ...args); }
    catch (e) { lastErr = e; await sleep(delay); }
  }
  throw lastErr;
}

async function revalUntil(page, fn, tries = 120, delay = 400) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { last = await page.evaluate(fn); } catch { last = false; }
    if (last) return true;
    await sleep(delay);
  }
  return false;
}

async function waitStableSocket(page, tag) {
  const start = Date.now();
  let lastState = null;
  let cycles = 0;
  while (Date.now() - start < 90000) {
    let ok = false;
    try { ok = await page.evaluate(() => Boolean(window._socket) && window._socket.connected); } catch { ok = false; }
    if (ok !== lastState) { console.log(`[${tag}] socket ${ok ? 'CONNECTED' : 'LOST'} @ ${Math.round((Date.now() - start) / 1000)}s`); lastState = ok; if (!ok) cycles++; }
    if (ok) {
      let stable = true;
      for (let j = 0; j < 4; j++) {
        await sleep(400);
        try { if (!(await page.evaluate(() => Boolean(window._socket) && window._socket.connected))) { stable = false; break; } } catch { stable = false; break; }
      }
      if (stable) { console.log(`[${tag}] socket stable (${cycles} reload cycles)`); return true; }
    }
    await sleep(300);
  }
  throw new Error(`${tag} socket never stable (${cycles} reload cycles)`);
}

async function getRoomCode(page) {
  return await reval(page, () => (window._roomCode && window._roomCode.current) || null);
}

// Instrument every page BEFORE any app script runs.
async function installInstrumentation(page) {
  await page.evaluateOnNewDocument(() => {
    const T = (...a) => console.log('[INSTR]', ...a);
    try {
      const md = navigator.mediaDevices;
      if (md) {
        const gu = md.getUserMedia.bind(md);
        md.getUserMedia = async (c) => {
          T('getUserMedia CALL', JSON.stringify(c));
          try { const s = await gu(c); T('getUserMedia OK', 'stream=' + s.id, 'tracks=' + s.getTracks().map(t => t.kind).join(',')); return s; }
          catch (e) { T('getUserMedia FAIL', e.name, '-', e.message); throw e; }
        };
        const gd = md.getDisplayMedia.bind(md);
        md.getDisplayMedia = async (c) => {
          T('getDisplayMedia CALL', JSON.stringify(c));
          try { const s = await gd(c); T('getDisplayMedia OK', 'stream=' + s.id, 'tracks=' + s.getTracks().map(t => t.kind).join(',')); return s; }
          catch (e) { T('getDisplayMedia FAIL', e.name, '-', e.message); throw e; }
        };
      }
      const at = RTCPeerConnection.prototype.addTrack;
      RTCPeerConnection.prototype.addTrack = function (track, ...streams) {
        const sender = at.call(this, track, ...streams);
        T('addTrack', track.kind, 'stream=' + (streams[0] ? streams[0].id : '?'), 'sendersNow=' + this.getSenders().length, 'pcIsCurrent=' + (this === window._pc));
        return sender;
      };
      const co = RTCPeerConnection.prototype.createOffer;
      RTCPeerConnection.prototype.createOffer = function (...args) {
        const p = co.apply(this, args);
        p.then(d => {
          const media = (d.sdp.match(/^m=(audio|video)/gm) || []).join('|');
          T('createOffer RESULT', media || 'NO_MEDIA_M_LINES', 'transceivers=' + this.getTransceivers().length, 'signaling=' + this.signalingState);
        }).catch(() => {});
        return p;
      };
      const ca = RTCPeerConnection.prototype.createAnswer;
      RTCPeerConnection.prototype.createAnswer = function (...args) {
        const p = ca.apply(this, args);
        p.then(d => {
          const media = (d.sdp.match(/^m=(audio|video)/gm) || []).join('|');
          T('createAnswer RESULT', media || 'NO_MEDIA_M_LINES', 'transceivers=' + this.getTransceivers().length);
        }).catch(() => {});
        return p;
      };
      const sl = RTCPeerConnection.prototype.setLocalDescription;
      RTCPeerConnection.prototype.setLocalDescription = function (d, ...r) { T('setLocalDesc', d && d.type); return sl.call(this, d, ...r); };
      const sr = RTCPeerConnection.prototype.setRemoteDescription;
      RTCPeerConnection.prototype.setRemoteDescription = function (d, ...r) { T('setRemoteDesc', d && d.type); return sr.call(this, d, ...r); };
      T('instrumentation installed');
    } catch (e) { console.log('[INSTR] init error:', e.message); }
  });
}

(async () => {
  let browser;
  const t0 = Date.now();
  const stamp = (s) => `[t=${String(Date.now() - t0).padStart(6)}ms] ${s}`;
  const consoleLog = [];
  const navLog = [];
  try {
    const { hostId, ctrlId } = await seedUsers();
    console.log(stamp('[E2E] users ready'));
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
    const hostPage = await browser.newPage();
    const ctrlPage = await browser.newPage();
    const capture = (page, tag) => {
      page.on('console', m => consoleLog.push(`[${tag}] ${stamp(m.text())}`));
      page.on('pageerror', e => consoleLog.push(`[${tag}] ${stamp('PAGEERROR: ' + e.message)}`));
    };
    hostPage.on('framenavigated', f => navLog.push(`[host] ${stamp(f.url())}`));
    ctrlPage.on('framenavigated', f => navLog.push(`[ctrl] ${stamp(f.url())}`));
    capture(hostPage, 'host');
    capture(ctrlPage, 'ctrl');
    await installInstrumentation(hostPage);
    await installInstrumentation(ctrlPage);

    // HOST
    await hostPage.evaluateOnNewDocument((t, n) => {
      try {
        localStorage.setItem('ircp_user', JSON.stringify({ token: t, name: n, email: 'x' }));
        localStorage.setItem('ircp_name', n);
      } catch {}
    }, tokenFor(hostId, HOST.email), HOST.name);
    await hostPage.goto(FRONT + '/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const clicked = await revalUntil(hostPage, () => {
      if (document.body.innerText.includes('Verified')) {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Collaboration Room'));
        if (btn) { btn.click(); return true; }
      }
      return false;
    });
    console.log(stamp('[E2E] host clicked Collaboration Room = ' + clicked));
    await sleep(2000);
    await waitStableSocket(hostPage, 'host');
    const roomCode = await getRoomCode(hostPage);
    console.log(stamp('[E2E] HOST room = ' + roomCode));
    if (!roomCode) throw new Error('no room code');
    await reval(hostPage, (code) => {
      const s = window._socket;
      if (s) s.on('connection-request', (payload) => {
        console.log('[AUTO] approving', payload && payload.id);
        window.__ctrlSocketId = payload.id;
        s.emit('respond-join', { controllerId: payload.id, approved: true, permission: 'view' }, code);
      });
    }, 60, 300, roomCode);

    // CONTROLLER
    await ctrlPage.evaluateOnNewDocument((t, n) => {
      try {
        localStorage.setItem('ircp_user', JSON.stringify({ token: t, name: n, email: 'x' }));
        localStorage.setItem('ircp_name', n);
      } catch {}
    }, tokenFor(ctrlId, CTRL.email), CTRL.name);
    await ctrlPage.goto(FRONT + '/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await revalUntil(ctrlPage, () => document.body.innerText.includes('Verified'));
    await ctrlPage.waitForSelector('input[maxlength="8"]', { timeout: 30000 });
    await ctrlPage.focus('input[maxlength="8"]');
    await ctrlPage.type('input[maxlength="8"]', roomCode, { delay: 40 });
    await sleep(400);
    await ctrlPage.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
    });
    await sleep(3000);
    const joined = await revalUntil(ctrlPage, () => {
      if (document.body.innerText.includes('Join Session')) {
        const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent && x.textContent.includes('Join Room'));
        if (b) { b.click(); return true; }
      }
      return false;
    });
    console.log(stamp('[E2E] ctrl clicked Join Room = ' + joined));
    await waitStableSocket(ctrlPage, 'ctrl');

    // let the initial negotiation complete
    await sleep(8000);

    // PHASE A: baseline diagnostics BEFORE camera toggles
    const diagA = {
      host: await reval(hostPage, collect),
      ctrl: await reval(ctrlPage, collect),
    };
    console.log('\n########## PHASE A (after initial negotiation, cameras OFF) ##########');
    console.log('--- HOST ---\n' + JSON.stringify(diagA.host, null, 2));
    console.log('--- CONTROLLER ---\n' + JSON.stringify(diagA.ctrl, null, 2));

    // enable cameras on BOTH sides (this is what the app's toggle does)
    const clickCam = async (page, label) => {
      const ok = await reval(page, () => {
        const b = document.querySelector('button[aria-label="Toggle Camera"]');
        if (b) { b.click(); return true; }
        return false;
      }, 30, 400);
      console.log(stamp(`[E2E] ${label} camera toggle clicked = ${ok}`));
      await sleep(1500);
    };
    await clickCam(hostPage, 'host');
    await clickCam(ctrlPage, 'ctrl');
    await sleep(8000);

    // PHASE B: after camera toggles - the fix should have auto-renegotiated media
    const diagB = {
      host: await reval(hostPage, collect),
      ctrl: await reval(ctrlPage, collect),
    };
    console.log('\n########## PHASE B (cameras ON, auto-renegotiation expected) ##########');
    console.log('--- HOST ---\n' + JSON.stringify(diagB.host, null, 2));
    console.log('--- CONTROLLER ---\n' + JSON.stringify(diagB.ctrl, null, 2));

    // PHASE C: settled-state verification of the fix
    await sleep(10000);
    const diagC = {
      host: await reval(hostPage, collect),
      ctrl: await reval(ctrlPage, collect),
    };
    const hostOk = diagC.host.senders.length > 0 && diagC.host.receivers.length > 0 && diagC.host.remoteStreams.length > 0;
    const ctrlOk = diagC.ctrl.senders.length > 0 && diagC.ctrl.receivers.length > 0 && diagC.ctrl.remoteStreams.length > 0;
    console.log('\n########## PHASE C: FIX VERIFICATION ##########');
    console.log('--- HOST ---\n' + JSON.stringify(diagC.host, null, 2));
    console.log('--- CONTROLLER ---\n' + JSON.stringify(diagC.ctrl, null, 2));
    console.log('\n[VERIFY] host senders=' + diagC.host.senders.length + ' receivers=' + diagC.host.receivers.length + ' remoteStreams=' + diagC.host.remoteStreams.length + ' => ' + (hostOk ? 'PASS' : 'FAIL'));
    console.log('[VERIFY] ctrl senders=' + diagC.ctrl.senders.length + ' receivers=' + diagC.ctrl.receivers.length + ' remoteStreams=' + diagC.ctrl.remoteStreams.length + ' => ' + (ctrlOk ? 'PASS' : 'FAIL'));
    console.log('[VERIFY] app ontrack-fired console events: ' + consoleLog.filter(l => l.includes('ontrack fired')).length);
    console.log('[VERIFY] media-bearing offers created: ' + consoleLog.filter(l => /\[INSTR\] createOffer RESULT m=/.test(l)).length);

    // Full ordered evidence log
    console.log('\n########## FULL ORDERED EVIDENCE LOG ##########');
    console.log(consoleLog.join('\n'));
    console.log('\n########## NAVIGATIONS ##########');
    console.log(navLog.join('\n'));
  } catch (err) {
    console.error('[E2E ERROR]', err.message);
    console.log('\n===== NAVIGATIONS =====\n' + navLog.slice(-40).join('\n'));
    console.log('\n===== CONSOLE (all) =====');
    console.log(consoleLog.join('\n'));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  }
})();

function collect() {
  const out = {};
  const pc = window._pc;
  if (pc) {
    out.connectionState = pc.connectionState;
    out.signalingState = pc.signalingState;
    out.iceState = pc.iceConnectionState;
    out.remoteStreams = pc.getRemoteStreams ? pc.getRemoteStreams().map(s => ({ id: s.id, tracks: s.getTracks().map(t => t.kind) })) : 'n/a';
    out.senders = pc.getSenders().map(s => {
      const t = s.track;
      return t ? { kind: t.kind, enabled: t.enabled, state: t.readyState } : 'null-track';
    });
    out.receivers = pc.getReceivers().map(r => r.track ? r.track.kind : 'null');
    out.transceivers = pc.getTransceivers().map(tc => ({ mid: tc.mid, dir: tc.direction, hasSnd: !!tc.sender.track, hasRcv: !!tc.receiver.track }));
  } else out.connectionState = 'NO_PC';
  out.videos = [];
  document.querySelectorAll('video').forEach(v => {
    const st = v.srcObject;
    out.videos.push({
      w: v.videoWidth, h: v.videoHeight, ready: v.readyState, hasStream: Boolean(st),
      tracks: st ? st.getTracks().map(t => `${t.kind}:${t.enabled}`) : [],
    });
  });
  return out;
}
