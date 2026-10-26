import React from 'react';
import { Alert } from 'react-native';

export type MonitorCandidate = { id: string; name?: string; email?: string };

// react-native-webrtc has no web implementation; the silent exam monitor is available in the
// iOS/Android app and in the web admin dashboard.
export function ExamMonitor({ roomId, onClose }: { roomId: string | null; onClose: () => void }) {
  React.useEffect(() => {
    if (!roomId) return;
    Alert.alert('Not available here', 'Use the mobile app or the web admin dashboard to monitor an exam.');
    onClose();
  }, [roomId, onClose]);
  return null;
}
