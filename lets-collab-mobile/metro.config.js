// Learn more: https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// yjs -> lib0 resolves `lib0/webcrypto` to `isomorphic-webcrypto` under the "react-native" export
// condition, which is not installed. Yjs only needs getRandomValues (client ids), so point it at
// a small shim backed by expo-crypto on iOS/Android. Web keeps lib0's own (browser crypto) build.
const LIB0_WEBCRYPTO_SHIM = path.resolve(__dirname, 'lib/shims/lib0-webcrypto.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'lib0/webcrypto' && platform !== 'web') {
    return context.resolveRequest(context, LIB0_WEBCRYPTO_SHIM, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
