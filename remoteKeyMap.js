// Maps browser KeyboardEvent key/code values from a remote controller to robotjs key names.
// Kept free of Electron imports so it can be unit-tested (tests/remoteKeyMap.test.mjs).
//
// Printable keys are mapped by their physical `code` (BracketLeft -> "[") and the controller's Shift
// state travels as a modifier, so Shift+[ types "{" on the host's own keyboard layout.

const NAMED_KEYS = {
  backspace: 'backspace', delete: 'delete', enter: 'enter', tab: 'tab', escape: 'escape', esc: 'escape',
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown', insert: 'insert',
  ' ': 'space', spacebar: 'space', capslock: 'capslock', printscreen: 'printscreen',
  meta: 'command', os: 'command', contextmenu: 'menu', // Windows/Command key on its own, menu key
};

const CODE_CHARS = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\', Space: 'space',
};

const NUMPAD = {
  NumpadAdd: 'numpad_+', NumpadSubtract: 'numpad_-', NumpadMultiply: 'numpad_*',
  NumpadDivide: 'numpad_/', NumpadDecimal: 'numpad_.', NumpadEnter: 'enter', NumLock: 'numpad_lock',
};

function mapBrowserKeyToRobotJS(key, code) {
  const keyText = String(key || '');
  const keyLower = keyText.toLowerCase();
  const codeText = String(code || '');

  if (NAMED_KEYS[keyLower]) return NAMED_KEYS[keyLower];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(keyLower)) return keyLower;

  if (/^Key[A-Z]$/.test(codeText)) return codeText[3].toLowerCase();
  if (/^Digit[0-9]$/.test(codeText)) return codeText[5];
  if (/^Numpad[0-9]$/.test(codeText)) return `numpad_${codeText[6]}`;
  if (NUMPAD[codeText]) return NUMPAD[codeText];
  if (CODE_CHARS[codeText]) return CODE_CHARS[codeText];

  // No usable code (some virtual keyboards): fall back to the character itself
  if (keyText.length === 1 && /[\x21-\x7e]/.test(keyText)) return keyLower;
  return null;
}

// robotjs modifier names: "control", not "ctrl" (an unknown name makes keyToggle throw)
function mapModifiers(mods) {
  if (!mods) return [];
  const active = [];
  if (mods.shift) active.push('shift');
  if (mods.ctrl) active.push('control');
  if (mods.alt) active.push('alt');
  if (mods.meta) active.push('command');
  return active;
}

module.exports = { mapBrowserKeyToRobotJS, mapModifiers };
