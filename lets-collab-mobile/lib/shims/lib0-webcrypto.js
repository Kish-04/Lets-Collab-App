// Replacement for `lib0/webcrypto` on iOS/Android (see metro.config.js).
// lib0's react-native build imports `isomorphic-webcrypto`, which this app does not ship.
import { getRandomValues as expoGetRandomValues } from 'expo-crypto';

export const getRandomValues = typedArray => expoGetRandomValues(typedArray);

// Yjs never uses SubtleCrypto; expose whatever the runtime provides for completeness.
export const subtle = globalThis.crypto ? globalThis.crypto.subtle : undefined;
