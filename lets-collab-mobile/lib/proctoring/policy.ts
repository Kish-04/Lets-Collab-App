import type { ProctoringAnalysis } from '../../modules/lc-proctoring';

/** Event names the web AntiCheatEngine reports (lib/AntiCheatEngine.ts) for these detections. */
export type ProctoringEventType = 'NO_FACE' | 'MULTIPLE_FACES' | 'LOOKING_AWAY' | 'FORBIDDEN_OBJECT';

export type ProctoringViolation = {
  type: ProctoringEventType;
  message: string;
  penalty: number;
};

/** Thresholds and penalties mirror the web engine's DEFAULT_CONFIG and emitEvent calls. */
export const PROCTORING_CONFIG = {
  /** web: headPoseMargin 0.50 */
  headPoseMargin: 0.5,
  /** web: eyeTrackingThreshold 0.80 */
  eyeTrackingThreshold: 0.8,
  /** web: >30 consecutive face-less frames; mobile samples ~2 fps, so it uses elapsed time instead. */
  noFaceMs: 2000,
  /** web: emitEvent drops repeats of the same type within 5 s. */
  cooldownMs: 5000,
  /** coco-ssd's default minimum score on the web. */
  objectMinScore: 0.5,
  /** web: forbidden = "cell phone" | "book" | "laptop" */
  forbiddenObjects: ['cell phone', 'book', 'laptop'],
};

/**
 * Turns raw on-device measurements into the same violations, messages and penalties as the web
 * candidate's AntiCheatEngine. Pure logic, no I/O.
 */
export class ProctoringPolicy {
  private lastEmit: Partial<Record<ProctoringEventType, number>> = {};
  private noFaceSince: number | null = null;

  reset() {
    this.lastEmit = {};
    this.noFaceSince = null;
  }

  evaluate(analysis: ProctoringAnalysis, now = analysis.timestamp || Date.now()): ProctoringViolation[] {
    const out: ProctoringViolation[] = [];
    const emit = (type: ProctoringEventType, message: string, penalty: number) => {
      const last = this.lastEmit[type];
      if (last !== undefined && now - last <= PROCTORING_CONFIG.cooldownMs) return;
      this.lastEmit[type] = now;
      out.push({ type, message, penalty });
    };

    if (analysis.faceCount === 0) {
      if (this.noFaceSince === null) this.noFaceSince = now;
      if (now - this.noFaceSince >= PROCTORING_CONFIG.noFaceMs) {
        emit('NO_FACE', 'Please face the camera', 10);
        this.noFaceSince = now;
      }
    } else {
      this.noFaceSince = null;
      if (analysis.faceCount > 1) emit('MULTIPLE_FACES', 'Multiple people detected in frame', 15);
      if (analysis.headOffset !== null && analysis.headOffset > PROCTORING_CONFIG.headPoseMargin) {
        emit('LOOKING_AWAY', 'Direct gaze lost', 5);
      }
      if (analysis.maxEyeLook > PROCTORING_CONFIG.eyeTrackingThreshold) {
        emit('LOOKING_AWAY', 'Suspicious precise eye movement (Iris darting) detected', 8);
      }
    }

    const forbidden = (analysis.objects || []).find(
      o => o.score >= PROCTORING_CONFIG.objectMinScore && PROCTORING_CONFIG.forbiddenObjects.includes(o.label),
    );
    if (forbidden) emit('FORBIDDEN_OBJECT', `Forbidden object (${forbidden.label}) detected`, 15);

    return out;
  }
}
