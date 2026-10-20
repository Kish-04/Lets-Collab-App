import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { ShieldCheck, ShieldAlert } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { BACKEND_URL, getAuthHeaders } from '../lib/api';
import { AnimatedPressable } from './AnimatedPressable';

type Verification =
  | { success: false; message: string }
  | { success: true; chainActive: false; message: string }
  | {
      success: true;
      chainActive: true;
      intact: boolean;
      chainStatus?: 'confirmed' | 'unconfirmed' | 'tampered' | 'empty';
      summary: { verified: number; tampered: number; not_on_chain: number; missing_local: number };
      transcript: { status: string };
      results: { status: string; eventType: string; chainHash: string | null; recomputedHash: string | null }[];
    };

/**
 * Recomputes a session's stored audit hashes on the server and compares them with the chain
 * (same endpoint as the web history page's "Verify integrity").
 */
export function AuditIntegrity({ sessionId }: { sessionId: string }) {
  const { colors } = useTheme();
  const [result, setResult] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(false);

  const verify = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions/${encodeURIComponent(sessionId)}/verify`, { headers: await getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      setResult(res.ok ? data : { success: false, message: data.message || 'Verification failed' });
    } catch (err: any) {
      setResult({ success: false, message: err?.message || 'Verification failed' });
    } finally {
      setLoading(false);
    }
  };

  const chip = (label: string, value: number | string, color: string) => (
    <View key={label} style={[styles.chip, { borderColor: color + '55', backgroundColor: color + '15' }]}>
      <Text style={[styles.chipText, { color }]}>{label} {value}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <AnimatedPressable
        hapticFeedback="light"
        onPress={verify}
        disabled={loading}
        style={[styles.button, { borderColor: colors.accent + '55', backgroundColor: colors.accent + '15' }]}
      >
        {loading ? <ActivityIndicator size="small" color={colors.accent} /> : <ShieldCheck size={16} color={colors.accent} />}
        <Text style={[styles.buttonText, { color: colors.accent }]}>{loading ? 'VERIFYING...' : 'VERIFY AUDIT TRAIL'}</Text>
      </AnimatedPressable>

      {result && !result.success && <Text style={[styles.message, { color: colors.red }]}>{result.message}</Text>}
      {result && result.success && !result.chainActive && <Text style={[styles.message, { color: colors.textDim }]}>{result.message}</Text>}
      {result && result.success && result.chainActive && (
        <View style={{ gap: 8 }}>
          <View style={styles.verdict}>
            {result.intact ? <ShieldCheck size={16} color={colors.emerald} /> : <ShieldAlert size={16} color={colors.red} />}
            <Text style={[styles.verdictText, { color: result.intact ? colors.emerald : colors.red }]}>
              {result.chainStatus === 'unconfirmed' ? 'No contradictions, but nothing found on the blockchain' : result.intact ? 'Local logs match the blockchain' : 'Tampering detected'}
            </Text>
          </View>
          <View style={styles.chips}>
            {chip('verified', result.summary.verified, colors.emerald)}
            {chip('tampered', result.summary.tampered, colors.red)}
            {chip('deleted', result.summary.missing_local, colors.red)}
            {chip('not on chain', result.summary.not_on_chain, colors.textDim)}
            {chip('chat', result.transcript.status.replace('_', ' '), result.transcript.status === 'tampered' ? colors.red : result.transcript.status === 'verified' ? colors.emerald : colors.textDim)}
          </View>
          {result.results
            .filter(r => r.status === 'tampered' || r.status === 'missing_local')
            .map((r, i) => (
              <Text key={i} style={[styles.problem, { color: colors.red }]}>
                {r.eventType}: {r.status === 'tampered' ? 'payload altered' : 'record deleted locally'}
              </Text>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  buttonText: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  message: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  verdictText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  chipText: { fontSize: 10, fontFamily: 'SpaceMono' },
  problem: { fontSize: 11, fontFamily: 'SpaceMono' },
});
