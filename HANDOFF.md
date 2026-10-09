# Handoff: DRCSFA / "Let's Collab" session summary

## Repo and git state
- **Repo:** `D:\Major Project\DRCSFA\...\b_qkshruWtwB6-1773162616837` (Windows; Git Bash + PowerShell).
- **Remote:** `vercelrepo` = `https://github.com/Kish-04/Lets-Collab-App.git`. The old `origin` was removed.
- **Branch:** `feature/security-e2e-federated-mobile`, pushed and 3 commits ahead of `main` (`ad024e9`):
  - `068818d` features
  - `7757591` v0.2.0 bump
  - `92976bc` Electron packaging excludes
- **Not done yet:** no PR opened (no `gh` CLI on this machine), CI has never run on GitHub, nothing merged. `main` deploys to production.
- **Desktop build:** `dist\Let's Collab Setup 0.2.0.exe` (254 MB), launch-tested. The old build is archived in `dist-0.1.14\` (gitignored).
- **Stack:**
  - Next.js 16 / React 19 web app: `app/`, `components/`, `lib/`, `hooks/`.
  - Electron: `main.js`, `preload.js`, plus a static export to `out/` when `IS_ELECTRON=true`.
  - Express + Socket.IO server: `server/index.js`, about 2,300 lines.
  - Expo SDK 57 mobile app: `lets-collab-mobile/`. Its `AGENTS.md` says to read the v57 docs first.
  - Hardhat + ethers v6: `server/contracts/IRCPTracker.sol`.

## Gotchas
- **Line endings:** many files are CRLF, notably `app/session/page.tsx` (about 3,100 lines) and `server/index.js`. Preserve them.
  - `sed -i` in Git Bash converts files to LF.
  - Patch scripts must normalize `\r\n` and tolerate trailing whitespace on blank lines.
- **Escaping:** Bash heredocs containing `\n` or backticks inside JS strings get mangled. Write patch scripts to a file instead.
- **Windows child processes:** `npx`/`shell: true` children need `taskkill /T /F`, run synchronously, or they leave servers running.
- **Generated noise:** `next build` and `next dev` toggle `next-env.d.ts` (`.next/types` vs `.next/dev/types`). Revert it before committing.
- **No database:** without one, the server uses the JSON mock store (`server/mockStore.js`), selected via `MOCK_STORE_FILE`. Tests rely on this.

## What was built or fixed, by area

### Federated learning
- **Model:** `lib/FederatedLearner.ts` uses a seeded init, tracks its base and round, and exposes `getDelta`/`applyGlobal`. `predict()` now scales anti-cheat penalties 0.5–1.5× (`federatedPenalty` in `page.tsx`).
- **Secure aggregation with dropout recovery** (Bonawitz-style):
  - Code: `lib/secureAggregation.ts`, `lib/shamir.ts`, `server/secureAggregation.js`, `server/shamir.js`.
  - Stages: advertise → share keys → masked input → unmask.
  - Server events: `fl-round-start`, `fl-join`, `fl-round-keys`, `fl-shares`, `fl-round-masking`, `fl-submit`, `fl-unmask`, `fl-unmask-shares`, `federated-aggregate`, `fl-model-sync`, `fl-sync-request`, `fl-round-aborted`.
  - Env: `FL_MIN_PARTICIPANTS` (default 3), `FL_*_MS`.
- **Real labels:** an admin false positive becomes a label-0 sample. `POST /api/admin/alerts/:id/status` calls `sendFalsePositiveLabel`, which emits `fl-label-correction` to the device that raised the alert.
  - Alerts store `features` and `sourceSocketId`.
  - Live `system-alert` events now include `_id`.

### End-to-end chat
- **Code:** `lib/E2EChat.ts` (protocol `e2e1`).
  - Per-member ECDH P-256 key; the host wraps the AES-GCM group key for each member with HKDF(salt = room code, info `drcsfa-chat-wrap-v1`).
  - Epochs rotate when a member leaves; host-key fingerprint is shown in the UI.
- **Server relay events:** `e2e-announce`, `e2e-roster` (sent from `emitRoomState`), `e2e-key-share`, `e2e-key-request`.
- **Chat limits:** ciphertext is limited to 4096 chars, and the event log no longer stores message text.
- **Web display:** decrypts at display time (`decryptedChat`). This also fixed history showing ciphertext. The old `lib/CryptoUtil.ts` is no longer used by `page.tsx`.
- **Mobile:** `lets-collab-mobile/lib/e2eChat.ts` (@noble); interop-tested against the web.

### Audit ledger / blockchain
- **Verification:** each anchor's payload and hash are stored in `room.anchors` and on `SessionLog`.
  - `GET /api/sessions/:id/verify` → `verifyAnchors` reports `verified`/`tampered`/`not_on_chain`/`missing_local`, plus a check of the chat transcript and evidence.
  - UI: the "Verify integrity" panel in `app/history/page.tsx`.
- **Archiving:** `SESSION_ARCHIVED` anchors a digest of the transcript and evidence.
- **Identities:** keyed HMAC via `AUDIT_HASH_SECRET`. Legacy keccak hashes still resolve.
- **Contract:** owner + writer access control (`setWriter`, `transferOwnership`; custom errors `NotWriter`/`NotOwner`).
- **Logger** (`server/blockchainLogger.js`, `server/chains.js`):
  - Env: `CHAIN_RPC_URL`, `CHAIN_PRIVATE_KEY`, `CONTRACT_ADDRESS`, `CONTRACT_DEPLOY_BLOCK`.
  - Ignores an `address.json` that belongs to a different chain.
  - Polygon priority-fee floor, `NonceManager`, chunked `eth_getLogs`, and session logs read via `getSessionLogs`.
  - Checks whether its wallet is a writer.
- **`address.json`:** now tagged `chainId: 11155111` (verified on-chain).
- **Hardhat:** Amoy/Polygon networks; scripts `deploy:amoy`, `deploy:polygon`.
- **Explorer links:** chain-aware via `explorerTxUrl` / `NEXT_PUBLIC_CHAIN_EXPLORER_TX_URL`.

### TURN / WebRTC
- **Credentials:** `server/turn.js` issues coturn REST credentials (`TURN_URLS`, `TURN_SECRET`, `TURN_CREDENTIAL_TTL`, `STUN_URLS`). The `/api/turn/credentials` route is rate-limited.
- **Client:** `fetchIceServers` asks the backend first. The host performs an ICE restart when a connection fails.
- **Deploy config:** `deploy/turn/turnserver.conf` and a `coturn` service in `docker-compose.yml` (profile `turn`).

### CRDT sync
- **Code:** `lib/CrdtSync.ts` runs over a new `ircp-crdt` data channel.
  - Previously the `yjs-update` and `ircp-excalidraw` labels had no matching channels, so sync silently did nothing.
  - API: `bindSharedDoc(name, doc, {relay, peerId})` and `observePeerDocs`.
  - `DataChannelManager` gained `onOpen` and `getOpenPeers`.
- **Whiteboard:** `components/ircp/StandaloneCanvas.tsx` is Yjs-backed with a flat `pageId::elementId` map. Supervised rooms are private per candidate.
- **Exam code:** `ExamControllerOverlay` sends to the host only; `ExamHostDashboard` shows a live view (`LiveCodeView`).

### Security fixes
- **Signed uploads** (`server/uploadAccess.js`): `/uploads` requires an HMAC-signed, expiring URL, and only admins receive them. External evidence URLs are rejected. Recordings are now serialized to admins. `recording-uploaded` is restricted to members.
- **Exams:**
  - Removed an unauthenticated duplicate `host-push-question` handler.
  - `answerKey` is stripped for candidates; grading happens on the server (`exam-answer-result`); answers lock after the final submit.
  - Room state omits questions a candidate has already submitted.
- **Admin camera observation:** fixed and authorised (`request-controller-observation`, `adminObservesController`, `end-controller-observation`). Supervised rooms only.
- **Emergency revoke:** Shift+Esc / Ctrl+Alt+Esc.
  - `main.js` sets a main-process `remoteInputLocked`, releases held keys and buttons, and calls the gamepad's `resetInputs`.
  - `panicRevokeAll` in `page.tsx` revokes every controller.
  - The server anchors `PANIC_REVOKE` and warns controllers. The lock lifts when control is granted again (`set-remote-input-lock`).

### Other features
- **Voice:** real pitch shifting via an AudioWorklet (`lib/VoiceChanger.ts`).
- **Audio proctoring:** on-device YAMNet via `@mediapipe/tasks-audio` (`hooks/useAudioProctoring.ts`). It replaced `webkitSpeechRecognition`, which sent audio to Google.
- **3D avatars:** `lib/Avatar3D.ts` (three.js + MediaPipe FaceLandmarker; robot, alien and bear).
- **Gemini pet:** receives the editor's code as context (`lib/petContext.ts`).

### Mobile (`lets-collab-mobile/`)
- **Participant sessions:** `app/session/[code].tsx`, including WebRTC, exam answering (`components/ExamPanel.tsx`, `lib/exam/`), E2E chat and on-device proctoring.
  - The proctoring native module is `modules/lc-proctoring`, using react-native-webrtc frame processors + MediaPipe. **It has never been compiled or run.**
- **Admin dashboard parity:**
  - Live sessions: correct events plus interventions, observation (`components/ObserverView.tsx`), evidence gallery, recordings and timeline.
  - Live alerts with real CSV export.
  - Exports via `lib/exportFile.ts` (expo-file-system v57 `File` API).
  - Audit verification (`components/AuditIntegrity.tsx`).
  - Chain-aware Blockchain tab.
- **Typecheck:** `npx tsc --noEmit` reports 0 errors.

### Desktop packaging
- Version is 0.2.0. `package.json` `build.files` now excludes the mobile apps, `dist-*`, `tests`, `deploy` and `.github`.

## Tests and CI
- **`npm test`:** `node --test "tests/*.test.mjs"`, 24 tests.
  - Unit: `e2eChat`, `secureAggregation`, `crdtSync`, `voicePitch`, `serverSecurity`.
  - `realtime.test.mjs`: 7 multi-client scenarios against the real in-process server.
  - Helper: `tests/helpers/loadTs.mjs` (TS transpile; `loadTsFresh` for separate module instances).
- **`npm run test:e2e`:** `tests/e2e/session.e2e.mjs`, Puppeteer with two Chrome profiles. Starts `next dev` on port 3107 plus the in-process server.
  - Covers: create, join, approve, WebRTC connect, E2E chat, Shift+Esc.
  - Not covered: screen share and remote input.
- **Server (`server/`):**
  - `npm test`: Jest API tests + Hardhat contract tests.
  - `npm run test:chain`: `test/blockchainLogger.integration.js`, which spawns `hardhat node` on port 8547.
- **CI:** `.github/workflows/ci.yml` with web, server, e2e and mobile jobs on Node 22. It has never run on GitHub; the e2e job is the most likely to need tweaks.
- **Last local run:** all green. Lint shows 0 errors and 18 warnings, all of them already there before this work.

## Cleanup and docs
- **Removed scratch files:** `diff*.txt`, `jobs.json`, `runs.json`, `temp_*`, `*.backup.js`, `test_puppeteer.js`, and others.
- **Moved:** `list_models*.js` → `scripts/`.
- **Untracked:** `app-config.json`; `.gitignore` updated.
- **`DEPLOYMENT.md`:** runbook for secrets, regional TURN, Amoy → Polygon deploy with ownership handover, and the EAS mobile build. A README link points to it.

## Open items
1. Open the PR, get CI green, and merge.
2. Before or at merge, set `AUDIT_HASH_SECRET` and `UPLOAD_URL_SECRET` in production. Note that old unsigned `/uploads` links will stop working.
3. **Security:** `server/adminRoutes.js` `loadAuthenticatedUser` still has a hardcoded admin-email fallback. It's both a bypass and a crash (it reassigns a `const`). Queued earlier as a separate task.
4. **Security:** `/api/upload-evidence-video` (`server/index.js`) has no authentication.
5. **Security:** `server/config.js` allows any `http://localhost:*` origin even in production.
6. **Security:** dangerous key combos from controllers (Win+R, Alt+F4) aren't blocked, and socket events aren't rate-limited.
7. **"Code Black":** still wipes evidence silently. It should be restricted and anchored.
8. **Mobile native proctoring:** needs a first EAS dev build to compile and test. iOS MediaPipe may need static frameworks.
9. **Missing on mobile:** voice answers and "Run code" in exams.
10. **Deployment** (needs the owner's accounts and funds): TURN VMs, Polygon deploy, EAS build.
11. **Desktop:** unsigned (SmartScreen warning) and has no auto-updater.
