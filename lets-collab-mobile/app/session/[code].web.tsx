import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MonitorPlay } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { normalizeRoomCode } from '../../lib/liveSession';

/**
 * react-native-webrtc has no web implementation, so the web build of this app
 * points participants to the main web client instead.
 */
export default function LiveSessionWebFallback() {
  const { colors } = useTheme();
  const { code } = useLocalSearchParams<{ code: string }>();
  const roomCode = normalizeRoomCode(code);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <MonitorPlay color={colors.accent} size={28} />
        <Text style={[styles.label, { color: colors.textDim }]}>ROOM {roomCode}</Text>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Join from the app</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Joining live sessions is available in the iOS and Android app, or in the Let's Collab web client.
        </Text>
        <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={[styles.btn, { backgroundColor: colors.accent }]}>
          <Text style={styles.btnText}>Back to dashboard</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, borderRadius: 24, borderWidth: 1, padding: 24, gap: 8 },
  label: { fontFamily: 'SpaceMono', fontSize: 10, letterSpacing: 1.5, marginTop: 8 },
  title: { fontFamily: 'Inter_900Black', fontSize: 22 },
  body: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  btn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#080810', fontFamily: 'Inter_700Bold', fontSize: 14 },
});
