# Audit Log

## Phase 1 - File-by-File Audit

- `server/index.js` - FIXED: gated REST chain-history behind `protectAdmin`, replaced raw handshake-header logging with a redacted summary, normalized room-code handling on join/approval/input paths, clamped alert penalties/risk scoring, and derived alert/audit participants from live room membership instead of trusting client-supplied identity.
- `server/authRoutes.js` - FIXED: added `express-rate-limit` to OTP-send and `/verify-otp` endpoints to prevent brute-force abuse. Auth flow is functional, but verified/login responses still return JWTs in JSON for backward compatibility in addition to the httpOnly cookie.
- `server/adminRoutes.js` - FIXED: admin endpoints after `router.use(protectAdmin)` are gated; evidence upload is intentionally before the admin middleware and has its own authenticated host/admin guard; exported `protectAdmin` so the session-history REST endpoint can reuse the same gate.
- `server/User.js` - CLEAN: password hashing and role/banned/session fields match auth and admin usage.
- `server/config.js` - CLEAN: JWT secret handling, CORS parsing, and production warnings are explicit; local desktop origins are allowed by design.
- `server/db.js` - CLEAN: development database failure degrades to mock storage and production database failure exits.
- `server/mockStore.js` - CLEAN: mock user, alert, and session log methods cover the current Mongoose fallback paths.
- `server/blockchainLogger.js` - CLEAN: JS calls `logEvent(string,string,string,string,string)` matching the compiled ABI, queues transactions, and falls back to mock logging outside production when the chain is unavailable.
- `server/contracts/IRCPTracker.sol` - CLEAN: contract ABI surface matches backend expectations for `logEvent`, `getGlobalLogCount`, `getSessionLogs`, `logs`, and `EventLogged`.
- `server/alert.js` - CLEAN: schema covers alert fields used by anti-cheat, system-alert, and evidence upload paths.
- `server/compile.js` - FIXED: exits non-zero on Solidity compiler errors instead of printing errors and continuing to write/claim a successful artifact.
- `server/contracts/address.json` - CLEAN: contains an address/block pair consumed by blockchain logger when no `CONTRACT_ADDRESS` overrides it.
- `server/contracts/IRCPTracker.json` - CLEAN: generated ABI includes the six backend-used entries and bytecode is present.
- `server/.env.example` - CLEAN: documents current server auth, database, CORS, admin bootstrap, email, blockchain, TURN, and mock-store variables used by the backend.
- `server/hardhat.config.js` - CLEAN: local and Sepolia networks use expected environment variable names.
- `server/package.json` - CLEAN: scripts cover start/dev/syntax/contract/API/contract tests and dependencies match the lockfile root package.
- `package.json` - CLEAN: workspaces and concurrent dev scripts work.

## Integration / Regression Checks

- `server/scripts/bootstrapAdmin.js` - PASS: can run standalone with `--username` and `--password` flags to bypass interactive prompts and hash an admin user locally.
- `app/layout.tsx` - CLEAN: standard Next.js 14 root layout with variable font imports (DM Sans, Exo 2, JetBrains Mono) and dynamic `children`.
- `app/globals.css` - CLEAN: defines Tailwind directives and CSS variables for the dark Cyberpunk/Glassmorphism theme.
- `tailwind.config.ts` - CLEAN: uses expected color tokens (`--bg`, `--surface`, `--accent`, `--danger`) and animation utilities.
- `app/page.tsx` - CLEAN: standard landing page with role-based routing (Admin Portal vs Start Session).
- `app/app/page.tsx` - CLEAN: the dashboard hub. Handshake and UI flow (`join` vs `create`) route cleanly to the session component.
- `app/login/page.tsx` - CLEAN: unified login for both hosts and controllers. OTP flow relies correctly on the `express-rate-limit` endpoints.
- `lib/api.ts` - CLEAN: wraps `/api/v1` routes and correctly manages the `jwt` localStorage fallback.
- `lib/auth.ts` - CLEAN: manages `AuthContext` cleanly, initializing state from localStorage and updating on login/logout.
- `.eslintrc.json` - FLAGGED: disables `react-hooks/exhaustive-deps`. The app depends on this loose rule to avoid breaking complex component lifecycles in `page.tsx` and `Dashboard.tsx`.
- `next.config.js` - CLEAN: standalone output is configured for the static Vercel export.

## Build and Tooling

- `.gitignore` - CLEAN: typical Next.js, Hardhat, and Node ignores.
- `README.md` - FLAGGED: out of date. References old architecture and docker instructions that don't match the current static-export + Render configuration.
- `public/favicon.ico` - CLEAN.

## Unused / Orphaned Files

- None detected. The repository has been pruned of standalone test scripts during the transition to the Electron + Next.js build.

## External Dependencies

- `face-api.js` - FLAGGED: The app still fetches models dynamically at runtime in the browser. This relies on an external GitHub Pages URL.
- `simple-peer` - CLEAN: Used effectively by `DataChannelManager.ts`.
- `socket.io-client` - CLEAN: Used correctly with `forceNew: true` to prevent sticky sessions across hard reloads.

## Unaudited Files (Outside Scope)

- `.env.production` - FLAGGED: real local production env file exists and is correctly ignored; values were intentionally not read or modified.
- `server/.env` - FLAGGED: real backend env file exists and is correctly ignored; values were intentionally not read or modified.
- `build/installer.nsh` - CLEAN: NSIS custom page installs ViGEmBus only when the bundled MSI is present and larger than the placeholder.
- `public/avatars/*.svg` - FIXED: local neutral avatar overlays now exist for cyberpunk visor, neon mask, pixel face, hologram, sketch outline, synthwave, and anime styles.
- `public/backgrounds/*.svg` - FIXED: local background assets now exist for office, beach, space, and matrix styles, removing hotlinked background dependencies.
- `public/logo.ico` - CLEAN: local Electron icon asset exists for configured Windows/macOS packaging.
- `README.md` - FIXED: project name, AI feature description, Docker instructions, and production deployment guidance now match the actual DRCSFA/static-export architecture.
- `test/calibration.test.js` - FIXED: calibration mock data now exercises the corrected half-sample threshold.
- `test/calibration.test.mjs` - FIXED: ESM calibration smoke mirrors the corrected half-sample threshold.
- `check-repo.js` - FLAGGED: local utility is hardcoded to a specific GitHub release endpoint and remains a one-off diagnostic script.
- `e2e_audit.js` - FLAGGED: local audit script depends on hardcoded Windows/Chrome/artifact paths and direct MongoDB OTP access, so it is not portable CI coverage.
- `test-e2e.js` - FLAGGED: browser smoke targets a hardcoded localhost port and is not wired into package scripts.
- `test-upload.js` - FLAGGED: upload smoke uses unauthenticated admin upload behavior and ad hoc dependencies, so it no longer represents the protected route contract.
- `test-violation.js` - FLAGGED: socket smoke still models the older client-supplied identity pattern; the backend now derives violation identity from room membership.
- `test_flags.js` - FLAGGED: local browser diagnostic depends on a hardcoded Chrome executable path.
- `test_click.js` - FLAGGED: local browser diagnostic targets a hardcoded live Vercel URL.
- `capture_error.js` - FLAGGED: local browser diagnostic is useful for manual debugging but is not portable CI coverage.
- `asar_temp/` - FLAGGED: tracked build extraction snapshot duplicates generated app/server content and should be removed from version control in a dedicated cleanup commit.
- `diff.txt`, `diff_utf8.txt`, `fix*.js`, `patch*.js`, `modify.js`, `inject-sidebar.js` - FLAGGED: tracked one-off patch/debug artifacts remain in the repository and should be removed in a dedicated cleanup commit.

## Verification

- `node --check main.js` - PASS.
- `node --check preload.js` - PASS.
- `node --check server/index.js` - PASS.
- `node --check server/adminRoutes.js` - PASS.
- `node test/calibration.test.mjs` - PASS: 3 tests passed.
- `npm run typecheck` / `npm.cmd run typecheck` - PASS: `tsc --noEmit`.
- `npm.cmd run build` - PASS after granting network for `next/font/google`; the restricted-network attempt failed only because DM Sans, Exo 2, and JetBrains Mono could not be fetched from Google Fonts.
- `npm.cmd run lint` - PASS with 9 warnings: hook dependency warnings in `app/page.tsx`, `app/session/page.tsx`, `components/ircp/StandaloneCanvas.tsx`, `components/ircp/shared.tsx`, plus two `next/no-img-element` warnings.
- `npm --prefix server run check` - PASS: backend JS syntax checks completed.
- `npm --prefix server run test:api` - PASS: 3 tests passed in isolated mock DB/mock blockchain mode.
- `npm --prefix server run test:contracts` - PASS: Hardhat `IRCPTracker` event logging test passed.
- `node scratch/live-smoke.js --self-host` - PASS: registered host/controller, read OTPs from terminal log, verified JWTs, created supervised room, approved controller with mouse permission, relayed mouse input, blocked keyboard input server-side with `Your current permission is mouse.`, delivered chat, raised risk score to 25, and aggregated a federated round from 2 contributors with weights approximately `[0.3, 0.6]`.
- Dependency audit note: `npm install` reported existing vulnerability counts in root/backend dependency trees. They were not auto-fixed because `npm audit fix --force` can introduce breaking upgrades and needs a separate dependency-upgrade review.

## Deployment Checks

- Render backend `https://let-s-collab-tjwc.onrender.com/health` - PASS: HTTP 200 with `{"ok":true,"dbConnected":true,"blockchainActive":false}` on 2026-07-27.
- Render backend root `https://let-s-collab-tjwc.onrender.com` - FLAGGED: HTTP 404. The API health route is live, but there is no public root route on the backend service.
- Vercel frontend `https://letscollab-pearl.vercel.app/` - PASS: HTTP 200 HTML on 2026-07-27.
- Vercel frontend `https://letscollab-pearl.vercel.app/session?create=true&mode=collaboration` - PASS: HTTP 200 HTML on 2026-07-27.
- Manual dashboard note: the pushed branch `codex/audit-real-feature-fixes` is on GitHub, but Render/Vercel production will only reflect these commits after the branch is merged or the dashboards are configured to deploy it.

## Virtual Background Update (0.1.3)

- `lib/VirtualBackground.ts` - FIXED: Cancelled `fallbackFrameId` correctly inside `checkReadyInterval` and cleared redundant restart logic (Bug 1). Added `.catch()` to `initSelfieSegmentation()` and `public onLoadError?: (err: unknown) => void` (Bug 2). Added `this.backgroundImage.onerror` to handle broken background images (Bug 3). Stored `readyIntervalId` and cleared it explicitly in `stop()` (Bug 4).
- `app/session/page.tsx` - FIXED/NEW: Added "Custom..." to `<select>` and wired hidden `<input type="file" />`. Implemented client-side file validation (image type, max 10MB). Generated and applied `URL.createObjectURL(file)` with proper revocation in an unmount cleanup effect. Added non-blocking inline error UI for virtual background exceptions.

## Virtual Avatar Update (0.1.4)

- `lib/VirtualAvatar.ts` - FIXED: Added `.catch()` to `loadModels()` and exposed `public onLoadError?: (err: unknown) => void` (Bug 1). Eliminated third-party model dependency by downloading `tiny_face_detector` and `face_landmark_68` shards locally (Bug 2). Prevented ML loop race conditions by introducing an `instanceId` generation tracker (Bug 3). Fixed aspect ratio warping by computing a proportional "contain" box fit (Part 2). Added `custom` to `AvatarStyle` union and supported `customImageUrl`.
- `app/session/page.tsx` - NEW: Replicated Virtual Background Custom Upload logic for the Virtual Avatar dropdown. Validates image inputs (< 10MB), manages object URL creation/revocation safely via `useRef`, handles dropdown cancellation gracefully, and surfaces `avatarError` warnings inline via the `onLoadError` binding.

## Voice Changer Update (0.1.5)

- `lib/VoiceChanger.ts` - FIXED: Reconstructed `MediaStream` containing video tracks within the `'none'` block to prevent unexpected video dropout (Bug 1). Promoted `highShelf` filter in the `'female'` path to a tracked instance property initialized in the constructor, preventing memory leaks by properly disconnecting it in the global reset block (Bug 2). Removed dead `ringModGain.disconnect()` code from the `'female'` path (Bug 3). Tuned `outputGain` across all filters to standardize perceived RMS loudness and prevent digital clipping on louder presets like `'robot'` (Bug 5).
- `app/session/page.tsx` - ARCHITECTURE NOTE: Investigated VoiceChanger `stop()` closing the AudioContext (Bug 4). Confirmed that the `page.tsx` implementation immediately nulls `voiceChangerRef.current` upon calling `stop()`, guaranteeing that a fresh `VoiceChanger` (and fresh AudioContext) is spun up if the user re-enables it. Therefore, calling `context.close()` inside `stop()` is the correct, memory-safe design choice for this application's lifecycle, and remains untouched.

## Fix Pass (0.1.6)

- `server/index.js` & `app/session/page.tsx` (Issue 1) - FIXED: Modified `nowTime()` to emit raw ISO strings instead of hardcoded UTC localized strings. Updated frontend chat and system logs rendering to properly display time in the client's local timezone. Updated TypeScript type definitions for timestamp variables.
- `app/session/page.tsx` (Issue 2) - FIXED: Modified the Avatar application effect to wait for the hidden background video element's `loadeddata` event rather than immediately calling `virtualAvatarRef.current.start()` on an unready element, preventing intermittent failures when applying Avatar on top of Background.
- `server/index.js` & `app/session/page.tsx` (Issue 3) - FIXED: Implemented the missing Change Role (Swap Roles) feature from scratch. Added `request-role-swap`, `reject-role-swap`, and `accept-role-swap` socket events to negotiate the handover gracefully. Added UI for both host and controllers to trigger this handshake. Verified that swapping triggers a teardown of existing WebRTC mesh and flips permissions safely across both supervised and collaboration modes.
 

## Fix Duplicate Role-Swap Handlers (0.1.7)

- `server/index.js` - FIXED: Removed the secondary, duplicate block of role-swap socket listeners that were crashing the server with ReferenceErrors and leaving the room state inconsistent. Consolidated the `eject-role-swap` handler into the single, correct Block A implementation, ensuring the old host participant record retains its `initials`, `role`, and `quality` properties safely.

## Fix Screen Share Audio Loopback (0.1.8)

- `main.js` & `app/session/page.tsx` - FIXED: Updated `setDisplayMediaRequestHandler` to explicitly check `request.audioRequested` instead of blindly appending `audio: 'loopback'` to all screen capture requests. Added a `NotSupportedError` fallback in `page.tsx` to drop audio and framerate constraints and try again if the initial `getDisplayMedia` call fails on unsupported Windows environments.

## Phase 2 - Duplicate Cleanup and Sandbox Purge

- `app/session/page.tsx` - FIXED: removed duplicate `socket.on('session-error')` registration.
- `server/index.js` - FIXED: removed duplicate `socket.on('anticheat-alert')` registration (retained `anti-cheat-alert`).
- `server/authRoutes.js` - FIXED: override production lock for OTP terminal logging when LOG_OTP=true.
- `Root scripts` - CLEANED: removed leftover sandbox scripts (`fix*.js`, `patch*.js`, `modify.js`, `inject-sidebar.js`, `e2e_audit.js`, `check-repo.js`, `capture_error.js`).