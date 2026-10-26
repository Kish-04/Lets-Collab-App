import { useEffect, useRef } from 'react';
import { describeFaceSteadily } from '@/lib/faceMatch';
import { getAuthHeaders, getBackendUrl } from '@/lib/utils';

/** Re-check the candidate's identity this often during a supervised exam */
export const FACE_REVERIFY_INTERVAL_MS = 5 * 60 * 1000;

// Periodic Face ID re-check during a supervised exam, using the same flow as the check at the start
// (descriptor computed on this device, compared with the enrolment by POST /api/face/verify). The
// server reports every result to the host and turns a mismatch into a reviewable alert, so this hook
// only tells the candidate. A candidate without Face ID enrolled is not re-checked.
export function useFaceReverify(
    videoRef: React.RefObject<HTMLVideoElement | null>,
    roomCodeRef: React.MutableRefObject<string | null>,
    sessionMode: string | null,
    role: string | null,
    connectionState: string,
    onResult: (status: 'verified' | 'mismatch') => void
) {
    const onResultRef = useRef(onResult);
    onResultRef.current = onResult;

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller' || connectionState !== 'connected') return;
        let stopped = false;
        let busy = false;

        const check = async () => {
            const video = videoRef.current;
            if (stopped || busy || !video || video.readyState < 2 || video.videoWidth === 0) return;
            busy = true;
            try {
                // No face or several faces are reported by the face proctoring itself; skip this round
                const sample = await describeFaceSteadily(video);
                if ('error' in sample || stopped) return;
                const res = await fetch(`${getBackendUrl()}/api/face/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ descriptor: sample.descriptor, room: roomCodeRef.current }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) return;
                if (data.status === 'not_enrolled') { stopped = true; return; }
                if (data.status === 'verified' || data.status === 'mismatch') onResultRef.current(data.status);
            } catch {
                // Network hiccup: try again next round
            } finally {
                busy = false;
            }
        };

        const timer = setInterval(check, FACE_REVERIFY_INTERVAL_MS);
        return () => { stopped = true; clearInterval(timer); };
    }, [videoRef, roomCodeRef, sessionMode, role, connectionState]);
}
