// Which remote input a controller's permission allows (mouse, keyboard, clipboard shortcuts).

function isClipboardShortcut(payload = {}) {
  const key = String(payload.key || '').toLowerCase();
  const code = String(payload.code || '').toLowerCase();
  const modifier = Boolean(payload.modifiers?.ctrl || payload.modifiers?.meta);
  return modifier && ['c', 'v', 'x'].some(shortcut => key === shortcut || code === `key${shortcut}`);
}

function isInputAllowed(participant, payload = {}) {
  const isMouse = ['mousemove', 'mousedown', 'mouseup', 'wheel'].includes(payload.type);
  const isKeyboard = ['keydown', 'keyup'].includes(payload.type);
  const isGamepad = payload.type === 'gamepad-state';
  if (isKeyboard && isClipboardShortcut(payload) && !participant.clipboardAllowed) return false;
  return participant.permission === 'full'
    || (participant.permission === 'mouse' && (isMouse || isGamepad))
    || (participant.permission === 'keyboard' && isKeyboard);
}

module.exports = { isClipboardShortcut, isInputAllowed };
