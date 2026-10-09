import React from 'react';
import { Alert } from 'react-native';

// react-native-webrtc has no web implementation; live observation is available in the
// iOS/Android app and in the web admin dashboard.
export function ObserverView({ roomId, onClose }: { roomId: string | null; onClose: () => void }) {
  React.useEffect(() => {
    if (!roomId) return;
    Alert.alert('Not available here', 'Use the mobile app or the web admin dashboard to observe a live screen.');
    onClose();
  }, [roomId, onClose]);
  return null;
}
