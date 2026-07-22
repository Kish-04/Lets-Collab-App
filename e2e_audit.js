const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const ARTIFACTS_DIR = 'C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\ae48ffd9-eed4-45aa-ae36-5656edbdc4fb\\artifacts';
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function loginUser(page, name, email) {
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (name, email) => {
    // Rely on the Next.js proxy rewrite so it's a same-origin request
    const proxyOrigin = 'http://localhost:3000';
    
    // Attempt registration first
    await fetch(proxyOrigin + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: 'password123' })
    });
  }, name, email);

  // Mongoose bypass to manually verify the user
  await mongoose.connect('mongodb://localhost:27017/ircp_db');
  await mongoose.connection.collection('users').updateOne(
    { email: email },
    { $set: { isVerified: true } }
  );
  await mongoose.disconnect();

  await page.evaluate(async (email) => {
    const proxyOrigin = 'http://localhost:3000';
    // Login to trigger the OTP generation
    const loginRes = await fetch(proxyOrigin + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' })
    });
    if (!loginRes.ok) throw new Error(`Login failed with status ${loginRes.status}`);
  }, email);

  // Retrieve the generated OTP from the database
  await mongoose.connect('mongodb://localhost:27017/ircp_db');
  const userDoc = await mongoose.connection.collection('users').findOne({ email: email });
  const otp = userDoc.otp;
  await mongoose.disconnect();

  if (!otp) throw new Error(`Failed to retrieve OTP from database for ${email}`);

  // Complete OTP verification to receive the token
  await page.evaluate(async (email, otp) => {
    const proxyOrigin = 'http://localhost:3000';
    const verifyRes = await fetch(proxyOrigin + '/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
      credentials: 'include' // Crucial for receiving Set-Cookie
    });
    
    if (verifyRes.ok) {
      const data = await verifyRes.json();
      localStorage.setItem('ircp_user', JSON.stringify(data.user || data));
      localStorage.setItem('ircp_name', data.user ? data.user.name : data.name);
    } else {
      throw new Error(`OTP Verification failed with status ${verifyRes.status}`);
    }
  }, email, otp);
}

async function run() {
  console.log('[Puppeteer] Launching browser...');
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: 'D:/Major Project/DRCSFA/Decentralized Remote Collaborative System with Federated AI/b_qkshruWtwB6-1773162616837/chrome/win64-152.0.7943.0/chrome-win64/chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--window-size=1280,720'
    ]
  });

  const hostContext = await browser.createBrowserContext();
  const controllerContext = await browser.createBrowserContext();

  const hostPage = await hostContext.newPage();
  const controllerPage = await controllerContext.newPage();

  hostPage.on('console', msg => console.log(`[Host Console] ${msg.type()}: ${msg.text()}`));
  hostPage.on('pageerror', err => console.error(`[Host Page Error] ${err.toString()}`));
  hostPage.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/api/auth/register')) {
      console.error(`[Host Response Error] ${response.status()} ${response.url()}`);
    }
  });

  controllerPage.on('console', msg => console.log(`[Controller Console] ${msg.type()}: ${msg.text()}`));
  controllerPage.on('pageerror', err => console.error(`[Controller Page Error] ${err.toString()}`));
  controllerPage.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/api/auth/register')) {
      console.error(`[Controller Response Error] ${response.status()} ${response.url()}`);
    }
  });

  await hostPage.setViewport({ width: 1280, height: 720 });
  await controllerPage.setViewport({ width: 1280, height: 720 });

  try {
    console.log('[Host] Authenticating via API to get real httpOnly cookie...');
  await loginUser(hostPage, 'Host User', 'host@test.com');

  console.log('[Controller] Authenticating via API to get real httpOnly cookie...');
  await loginUser(controllerPage, 'Controller User', 'controller@test.com');

  console.log('[Host] Navigating to create a SUPERVISED session (auto-triggers AI calibration)...');
  await hostPage.goto(`http://localhost:3000/session?create=true&mode=supervised`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1000));

  console.log('[Host] Extracting Room Code (15s timeout)...');
  const roomCode = await hostPage.evaluate(() => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (attempts > 30) {
          clearInterval(interval);
          reject('TIMEOUT: Room code never appeared after 15 seconds.');
        }
        const els = Array.from(document.querySelectorAll('.font-mono'));
        const codeEl = els.find(e => e.innerText && /^[A-Z0-9]{8}$/i.test(e.innerText.trim()));
        if (codeEl) {
          clearInterval(interval);
          resolve(codeEl.innerText.trim());
        }
      }, 500);
    });
  });

  console.log(`[Host] Created Room: ${roomCode}`);

  console.log('[Controller] Joining Room...');
  await controllerPage.goto(`http://localhost:3000/session?join=true`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1000));

  // Type in the code using Puppeteer to ensure React state updates
  const inputSelector = 'input[placeholder*="Room"]';
  await controllerPage.waitForSelector(inputSelector);
  await controllerPage.type(inputSelector, roomCode);
  
  await controllerPage.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const joinBtn = btns.find(b => b.innerText.toLowerCase().includes('join'));
    if (joinBtn) joinBtn.click();
  });

  console.log('[Host] Waiting for and clicking Approve button...');
  await hostPage.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some(b => b.innerText.includes('Approve'));
  }, { timeout: 15000 });
  
  await hostPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const approveBtn = buttons.find(b => b.innerText.includes('Approve'));
    if (approveBtn) approveBtn.click();
  });

  console.log('[Controller] Waiting for Calibration Overlay to auto-trigger...');
  const isControllerCalibrating = await controllerPage.evaluate(() => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (attempts > 30) {
          clearInterval(interval);
          reject('TIMEOUT: AI Calibration overlay did not appear for Controller.');
        }
        if (document.body.innerText.includes('Keep your head still') || document.body.innerText.includes('Calibrating') || document.body.innerText.includes('CALIBRATING')) {
          clearInterval(interval);
          resolve(true);
        }
      }, 500);
    });
  });
  
  if (isControllerCalibrating) {
      console.log('[Controller] Calibration auto-triggered successfully!');
      await controllerPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase3_controller_calibration.png') });
  }

  console.log('[Controller] Waiting for Connected state...');
  await new Promise(r => setTimeout(r, 4000));

  await hostPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase1_host_connected.png') });
  await controllerPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase1_controller_connected.png') });

  console.log('[Host] Clicking Share Screen...');
  await hostPage.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const shareBtn = btns.find(b => b.innerHTML.includes('Monitor') || b.innerText.includes('Share') || b.innerText.includes('Screen') || b.innerText.includes('START SHARING'));
    if (shareBtn) {
        shareBtn.click();
    } else {
        const dockBtns = document.querySelectorAll('button.rounded-full');
        if (dockBtns.length > 0) {
            dockBtns[0].click();
        }
    }
  });

  console.log('[Controller] Waiting for video stream from Host...');
  await new Promise(r => setTimeout(r, 5000));
  
  const controllerVideoActive = await controllerPage.evaluate(async () => {
    let isPlaying = false;
    let bytesReceived = 0;
    let iceServers = [];

    for (let i = 0; i < 50; i++) {
        const videos = Array.from(document.querySelectorAll('video'));
        videos.forEach((v, idx) => {
            if (v.srcObject) {
                console.log(`[Video ${idx}] HAS srcObject. readyState: ${v.readyState}, paused: ${v.paused}, currentTime: ${v.currentTime}`);
                if (v.paused || v.readyState < 3) {
                    v.muted = true;
                    v.play().catch(e => console.error(`[Video ${idx}] Play error:`, e));
                }
            } else {
                if (i % 10 === 0) console.log(`[Video ${idx}] NO srcObject yet.`);
            }
        });
        
        isPlaying = videos.some(video => video.readyState >= 3 && video.currentTime > 0 && !video.paused);
        if (isPlaying) break;
        await new Promise(r => setTimeout(r, 100));
    }
    
    if (window._pc) {
      iceServers = window._pc.getConfiguration().iceServers;
      const stats = await window._pc.getStats();
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          bytesReceived += report.bytesReceived || 0;
        }
      });
    }
    
    return { isPlaying, bytesReceived, iceServers };
  });

  console.log(`[Controller] Video Active (Playing): ${controllerVideoActive.isPlaying}`);
  console.log(`[Controller] Video Bytes Received: ${controllerVideoActive.bytesReceived}`);
  console.log(`[Controller] Configured ICE Servers:`, controllerVideoActive.iceServers);
  await controllerPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase1_controller_video.png') });
  
  console.log('Writing final report...');
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'e2e_report.json'), JSON.stringify({
    roomCode,
    controllerVideoActive,
    isControllerCalibrating,
    status: 'COMPLETE'
  }, null, 2));

    await browser.close();
    console.log('Audit script finished.');
  } catch (err) {
    console.error('ERROR during execution:', err);
    await hostPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'error_host.png') }).catch(()=>{});
    await controllerPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'error_controller.png') }).catch(()=>{});
    await browser.close();
    process.exit(1);
  }
}

run().catch(console.error);
