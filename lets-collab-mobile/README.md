# Let's Collab Mobile

Expo (SDK 57, expo-router) app for Let's Collab. It has two parts:

- **Admin dashboard**: the overview, sessions, alerts, blockchain, users and reports tabs.
- **Live session participant**: join a collaboration room or a supervised exam from iOS or Android (route `app/session/[code].tsx`, opened from the "Join as participant" card on the Overview tab).

## Development build required

Live sessions use `react-native-webrtc`, which is a native module. It does **not** run in Expo Go. Use a development build:

```bash
npm install
# Local native build (generates the ignored android/ and ios/ folders from app.json):
npx expo prebuild --clean
npx expo run:android      # or: npx expo run:ios
# Or with EAS:
eas build --profile development --platform android
```

The `android/` folder is generated and ignored by git. Run `npx expo prebuild --clean` again after you change `app.json` plugins or permissions. If you skip this, the existing native project won't have WebRTC or the camera and microphone permissions.

Native configuration lives in `app.json`:

- The `@config-plugins/react-native-webrtc` plugin, which also sets the iOS camera and microphone usage strings.
- `ios.infoPlist`: `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`.
- `android.permissions`: `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `ACCESS_NETWORK_STATE` and `WAKE_LOCK`.

The web build of this app shows a placeholder for `/session/[code]` (`[code].web.tsx`) because WebRTC isn't available there through `react-native-webrtc`.

## How joining works

The mobile app joins as a **controller**, the same role the web client gives a participant. It uses the web client's Socket.IO protocol (`app/session/page.tsx`):

1. It connects to `BACKEND_URL` with `auth: { token }`, using the token saved at login in `expo-secure-store`.
2. It sends `join-room(code, 'controller', { name, device })`. The server replies with `join-pending`, and the host approves the request (`join-approved`) or denies it (`join-denied`).
3. The host sends an `offer` and creates the `ircp-*` data channels. The phone answers, and the two sides exchange `ice-candidate` messages. ICE servers come from `GET /api/turn/credentials`.
4. Chat is end-to-end encrypted with the web protocol `e2e1` (`lib/e2eChat.ts`, a byte-compatible @noble port of the web `lib/E2EChat.ts`). Once the phone is a room member (first `session-state`), it makes a per-session ECDH P-256 key pair and sends `e2e-announce {roomId, publicKey}`. The host replies with `e2e-key-share`: its keyring of AES-256-GCM group keys (one per epoch), wrapped with HKDF-SHA256 over the ECDH secret (salt = room code, info `drcsfa-chat-wrap-v1`). Messages are sent as `chat-message {roomId, text: "e2e1:<epoch>:<base64(iv|ct)>"}`. The server only ever sees ciphertext. Messages are decrypted for display only. If an epoch is missing, the phone sends `e2e-key-request`, at most once every 5 s. Sending is blocked until a key arrives. The chat header shows `E2E <fingerprint>` (the first 9 characters of the host key fingerprint, the same as the web) or `E2E pending`.
5. In supervised rooms, the front camera and mic are required. If the app leaves the foreground, it sends `anti-cheat-alert` (type `tab-switch`, penalty 100) and the session ends, the same as a tab switch on the web. The screen stays awake for the whole session (`expo-keep-awake`).

### Supervised exams on mobile

- **Questions.** The phone gets questions from `new-exam-question` and from `session-state.examQuestions` (for late joiners). It shows them one at a time with Prev/Next, like the web `ExamControllerOverlay`. Question types are `freeform`, `mc`, `poll` and `code`. Code questions use a plain monospace `TextInput`, because Monaco is not available in React Native.
- **Answers.** The phone sends the same events and payloads as the web: `controller-draft-answer {questionId, answer, roomId}` and `controller-submit-answer {questionId, answer, roomId}`, where `answer` is `{ text }`. Drafts are debounced to 400 ms while typing and sent immediately for option picks. A submitted question is removed locally, the same as on the web.
- **Live code view.** The phone joins the host's `ircp-crdt` data channel and syncs the Yjs doc `exam-code` with the web `lib/CrdtSync.ts` protocol. Each question's code is stored in `doc.getText('monaco:' + questionId)`, which is seeded with the starter code. Every TextInput change is applied as a single minimal replace, using the common prefix and suffix. See `lib/exam/codeSync.ts`.
- **Yjs on React Native.** `lib0` (a Yjs dependency) imports `isomorphic-webcrypto` under the `react-native` export condition. `metro.config.js` points `lib0/webcrypto` at `lib/shims/lib0-webcrypto.js`, which uses `expo-crypto`'s `getRandomValues`.

### On-device proctoring

Supervised rooms run the same checks as the web `AntiCheatEngine`, entirely on the phone:

| Check | Model | Event, message and penalty sent with `system-alert` |
| --- | --- | --- |
| No face for 2 s or longer | MediaPipe FaceLandmarker (`face_landmarker.task`, the model the web uses) | `NO_FACE`, "Please face the camera", 10 |
| More than one face | same | `MULTIPLE_FACES`, "Multiple people detected in frame", 15 |
| Head turned (nose offset > 0.5 eye widths) | same | `LOOKING_AWAY`, "Direct gaze lost", 5 |
| `eyeLook*` blendshape > 0.8 | same | `LOOKING_AWAY`, "Suspicious precise eye movement (Iris darting) detected", 8 |
| Phone, book or laptop (score 0.5 or higher) | MediaPipe ObjectDetector, EfficientDet-Lite0 (COCO) | `FORBIDDEN_OBJECT`, "Forbidden object (cell phone) detected", 15 |

Each event type has a 5 s cooldown, the same as the web. The payload is `{ type: 'anticheat_violation', event, message, penalty, room }`, matching the web. It has no `evidenceUrl`: the web uploads a webcam snapshot as evidence, but the phone never sends camera frames anywhere except through the WebRTC call. If proctoring cannot run, the phone sends one `system-alert` (`type: 'system'`, `event: 'PROCTORING_UNAVAILABLE'`, penalty 0) so the invigilator knows.

**How frames are obtained without opening the camera twice.** react-native-webrtc 124 has a video-effects hook: native code registers a named frame processor with `ProcessorProvider` (Android `VideoFrameProcessor`, iOS `VideoFrameProcessorDelegate`). JS then attaches it to a local camera track with `track._setVideoEffects([name])`. The local Expo module `modules/lc-proctoring` registers a pass-through processor, which returns every frame to WebRTC unchanged, so the call is never paused, delayed or altered. At most every 500 ms, and only when the previous frame has finished, it copies one frame downscaled to 480 px into CPU memory and runs MediaPipe on a background thread. Only numbers leave the module (face count, head offset, eye-look score, object labels). `lib/proctoring/policy.ts` turns those numbers into violations. The session screen only uses `lib/proctoring` (`useOnDeviceProctoring`), so the frame source or models can be swapped there.

**Trade-offs and alternatives considered**

- *react-native-vision-camera with ML Kit or fast-tflite.* This would open a second camera session on the same front camera that WebRTC already holds. Android and iOS generally give the camera to one client at a time, so the call video would stop or the two would fight over the camera. Rejected.
- *Time-slicing* (pausing WebRTC capture to take photos) interrupts the call video. Rejected.
- *The WebRTC frame tap (chosen).* It uses an underscore-prefixed react-native-webrtc API (`_setVideoEffects`), so check it again when upgrading react-native-webrtc. It only works on camera tracks created by `getUserMedia`. Setting effects replaces any other processor on that track. On iOS it also replaces the capturer delegate, which is the library's own design.
- *Models* are downloaded once on first use from Google's MediaPipe model storage, the same source the web engine uses, and cached in the app's document directory (`proctoring-models/`, about 4 MB + 7 MB). If the object model can't be downloaded, the face checks still run and the banner says phone detection is unavailable.
- *Sampling rate* is about 2 analysed frames per second, compared with every animation frame on the web. A glance shorter than about 0.5 s can be missed.
- *Not ported from the web engine:* voice and talking detection, blink and emotion heuristics, typing-rhythm checks, screenshot evidence, and federated-learning penalty scaling. Mobile uses the base penalties.

**Native setup.** `modules/lc-proctoring` is autolinked as a local Expo module (the `nativeModulesDir` default is `./modules`). No config plugin or extra permission is needed beyond the camera permission the app already has. It adds `com.google.mediapipe:tasks-vision:0.10.33` on Android and the `MediaPipeTasksVision` 0.10.33 pod on iOS, which makes the app binary noticeably larger. **Rebuild the development build** after pulling this change (`npx expo prebuild --clean` + `npx expo run:android|ios`, or a new EAS dev build). A binary without the module still runs, but proctoring then shows as "unavailable" and is reported to the invigilator as such.

### Not supported on mobile yet

- Remote control input (the `ircp-input` channel), file transfer and the whiteboard. The phone accepts these data channels and ignores them.
- Exam extras from the web overlay: recording a voice answer, playing a question's voice prompt, and "Run code" (the web runs code through the web app's own `/api/execute` route).
- Hosting a room, and admin "observe controller" camera requests.
