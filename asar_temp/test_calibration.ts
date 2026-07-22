const { AntiCheatEngine } = require('./lib/AntiCheatEngine');

const engine = new AntiCheatEngine();
engine.setConfig({ eyeTrackingThreshold: 0.85, emotionSensitivity: 0.70 });
engine.setConfig({ eyeTrackingThreshold: 0.50, emotionSensitivity: 0.40 });
