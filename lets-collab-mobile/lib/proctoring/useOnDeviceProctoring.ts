import { useEffect, useRef, useState } from 'react';
import type { MediaStreamTrack } from 'react-native-webrtc';
import LcProctoring from '../../modules/lc-proctoring';
import { ensureProctoringModels } from './models';
import { ProctoringPolicy, ProctoringViolation } from './policy';

export type ProctoringState = 'idle' | 'loading' | 'active' | 'unavailable' | 'error';

export type ProctoringStatus = {
  state: ProctoringState;
  message: string;
  /** False when the face checks run but the phone/object model could not be loaded. */
  objectDetection: boolean;
};

/** Analyse at most ~2 frames per second (the call itself keeps its full frame rate). */
const SAMPLE_INTERVAL_MS = 500;
/** If no analysed frame arrives for this long while active, report the pipeline as stalled. */
const STALL_MS = 10000;

/** Increments per proctoring run, so a late-finishing old run never stops a newer one. */
let runGeneration = 0;

const IDLE: ProctoringStatus = { state: 'idle', message: '', objectDetection: false };

/**
 * On-device proctoring of the live WebRTC camera track. Frames are tapped inside
 * react-native-webrtc's capture pipeline by the local `lc-proctoring` native module, analysed on
 * the phone, and only the resulting violations are reported (see README, "On-device proctoring").
 */
export function useOnDeviceProctoring(
  enabled: boolean,
  track: MediaStreamTrack | null,
  onViolation: (violation: ProctoringViolation) => void,
): ProctoringStatus {
  const [status, setStatus] = useState<ProctoringStatus>(IDLE);
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;

  useEffect(() => {
    if (!enabled || !track) {
      setStatus(IDLE);
      return;
    }
    const native = LcProctoring;
    if (!native) {
      setStatus({
        state: 'unavailable',
        message: 'This app build does not include the on-device proctoring module. Rebuild the development build.',
        objectDetection: false,
      });
      return;
    }

    let cancelled = false;
    const generation = ++runGeneration;
    let lastAnalysisAt = 0;
    let objectDetection = false;
    const policy = new ProctoringPolicy();
    const subscriptions: { remove: () => void }[] = [];
    let watchdog: ReturnType<typeof setInterval> | null = null;

    const activeStatus = (): ProctoringStatus => ({
      state: 'active',
      message: objectDetection
        ? 'On-device AI proctoring active'
        : 'On-device face checks active; phone detection unavailable',
      objectDetection,
    });

    const run = async () => {
      setStatus({ state: 'loading', message: 'Preparing on-device AI proctoring...', objectDetection: false });
      const models = await ensureProctoringModels();
      if (models.objectError) console.warn('[Proctoring] object model unavailable:', models.objectError);
      if (cancelled) return;

      subscriptions.push(
        native.addListener('onAnalysis', analysis => {
          lastAnalysisAt = Date.now();
          policy.evaluate(analysis).forEach(violation => onViolationRef.current(violation));
        }),
        native.addListener('onError', ({ message }) => console.warn('[Proctoring] analysis error:', message)),
      );

      const result = await native.start(models.face, models.object, SAMPLE_INTERVAL_MS);
      if (cancelled) {
        // The cleanup's stop() may have run before start() finished registering.
        if (generation === runGeneration) {
          try { native.stop(); } catch { }
        }
        return;
      }
      objectDetection = Boolean(result?.objectDetection);

      // Attach the pass-through frame tap to the camera track that is already being sent to the host.
      track._setVideoEffects([native.processorName]);
      lastAnalysisAt = Date.now();
      setStatus(activeStatus());

      watchdog = setInterval(() => {
        const stalled = Date.now() - lastAnalysisAt > STALL_MS;
        setStatus(prev => {
          if (stalled && prev.state === 'active') {
            return { ...prev, state: 'error', message: 'On-device proctoring is not receiving camera frames' };
          }
          if (!stalled && prev.state === 'error') return activeStatus();
          return prev;
        });
      }, 3000);
    };

    run().catch(err => {
      if (cancelled) return;
      setStatus({ state: 'error', message: `On-device proctoring failed: ${err?.message || err}`, objectDetection: false });
    });

    return () => {
      cancelled = true;
      if (watchdog) clearInterval(watchdog);
      subscriptions.forEach(sub => sub.remove());
      try { track._setVideoEffects([]); } catch { }
      if (generation === runGeneration) {
        try { native.stop(); } catch { }
      }
    };
  }, [enabled, track]);

  return status;
}
