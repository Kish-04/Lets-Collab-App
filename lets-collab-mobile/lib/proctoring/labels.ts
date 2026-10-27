// Plain names for proctoring alerts, as the web admin dashboard shows them.
// Keep in sync with PROCTORING_RULES and ALIASES in the web app's lib/proctoringPolicy.ts.

const LABELS: Record<string, string> = {
  NO_FACE: 'Face not visible (no one in front of the camera)',
  FACE_BLOCKED: 'Face hidden or blocked (person in view, face not visible)',
  MULTIPLE_FACES: 'Another person in view',
  LOOKING_AWAY: 'Looking away from the screen',
  FACE_OUT_OF_FRAME: 'Face too far or partly out of frame',
  PHONE_DETECTED: 'Phone visible in camera',
  BOOK_DETECTED: 'Book or notes visible in camera',
  SCREEN_DETECTED: 'Another screen or laptop visible in camera',
  CAMERA_COVERED: 'Camera blocked or covered',
  CAMERA_DARK: 'Camera too dark',
  CAMERA_FROZEN: 'Camera image frozen',
  CAMERA_OFF: 'Camera turned off',
  VOICE_DETECTED: 'Talking detected',
  WHISPER_DETECTED: 'Whispering detected',
  MULTIPLE_VOICES: 'More than one voice / conversation',
  PHONE_AUDIO: 'Phone ringing or dialing heard',
  LOUD_NOISE: 'Loud background noise',
  MIC_OFF: 'Microphone muted or lost',
  TAB_SWITCHED: 'Left the exam window',
  FULLSCREEN_EXIT: 'Exited full screen',
  CLIPBOARD: 'Clipboard / copy-paste activity',
  DEVTOOLS: 'Developer tools shortcut',
  SCREEN_CAPTURE: 'Screenshot key pressed',
  SUSPICIOUS_SHORTCUT: 'Window-switching shortcut',
  REMOTE_DESKTOP: 'Remote desktop / remote-control app',
  VIRTUAL_MACHINE: 'Running inside a virtual machine',
  SECOND_SCREEN: 'Second display connected',
  IDENTITY_MISMATCH: 'Face does not match enrolled Face ID',
  TYPING_ANOMALY: 'Typing pattern anomaly',
};

// Older or detector-specific event names that count as one of the kinds above
const ALIASES: Record<string, string> = {
  LOOK_AWAY: 'LOOKING_AWAY', EYE_DARTING: 'LOOKING_AWAY', GAZE_AWAY: 'LOOKING_AWAY',
  FORBIDDEN_OBJECT: 'PHONE_DETECTED', OBJECT_DETECTED: 'PHONE_DETECTED',
  BOOK: 'BOOK_DETECTED', SECOND_DEVICE: 'SCREEN_DETECTED', LAPTOP_DETECTED: 'SCREEN_DETECTED',
  FACE_HIDDEN: 'FACE_BLOCKED', FACE_COVERED: 'FACE_BLOCKED',
  TALKING_DETECTED: 'VOICE_DETECTED', SPEECH_DETECTED: 'VOICE_DETECTED',
  WHISPER: 'WHISPER_DETECTED', CONVERSATION: 'MULTIPLE_VOICES',
  SUSPICIOUS_NOISE: 'LOUD_NOISE', FACE_TOO_FAR: 'FACE_OUT_OF_FRAME', FACE_PARTIAL: 'FACE_OUT_OF_FRAME',
  CAMERA_BLOCKED: 'CAMERA_COVERED', CAMERA_ENDED: 'CAMERA_OFF', MIC_MUTED: 'MIC_OFF',
  BLUR_EVENT: 'TAB_SWITCHED', BLURR_EVENT: 'TAB_SWITCHED', CLIPBOARD_CHANGE: 'CLIPBOARD',
  BANNED_PROCESS: 'REMOTE_DESKTOP', PRINT_SCREEN: 'SCREEN_CAPTURE', MULTI_MONITOR: 'SECOND_SCREEN',
};

/** The plain label for a proctoring event name, or null when it is not a proctoring kind. */
export function proctoringLabel(type: string): string | null {
  const upper = String(type || '').trim().toUpperCase();
  return LABELS[ALIASES[upper] || upper] ?? null;
}
