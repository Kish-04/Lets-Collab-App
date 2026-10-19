// Keys a remote controller may never press on the host, whatever permission they hold.
// Kept free of Electron imports so it can be unit-tested (tests/remoteInputPolicy.test.mjs).
//
// The Windows / Command key opens the Run box (Win+R), the power-user menu (Win+X), locks or
// shows the desktop and starts apps, so any combo that uses it is refused. The rest switch away
// from the shared window, close it, or open the Start menu / Task Manager.

const OS_KEYS = new Set(['meta', 'os', 'win', 'super', 'command', 'cmd', 'contextmenu']);

function isBlockedRemoteKey(payload) {
  if (!payload || payload.type !== 'keydown') return false; // releasing a key is always allowed
  const mods = payload.modifiers || {};
  const key = String(payload.key || '').toLowerCase();
  const code = String(payload.code || '').toLowerCase();

  if (mods.meta || OS_KEYS.has(key) || code.startsWith('meta') || code.startsWith('os')) return true;
  const isTab = key === 'tab';
  const isEsc = key === 'escape' || key === 'esc';
  const isF4 = key === 'f4';
  if (mods.alt && (isTab || isEsc || isF4)) return true; // Alt+Tab, Alt+Esc, Alt+F4
  if (mods.ctrl && isEsc) return true;                   // Ctrl+Esc (Start), Ctrl+Shift+Esc (Task Manager)
  return false;
}

module.exports = { isBlockedRemoteKey };
