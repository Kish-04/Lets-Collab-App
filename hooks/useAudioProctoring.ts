import { useEffect, useRef } from 'react';
import type { AudioClassifier } from '@mediapipe/tasks-audio';
import { SustainedSignal, audioProctoringSuppressed } from '@/lib/proctoringPolicy';

const AUDIO_PROCTOR_CONFIG = {
    /** Energy (mean of squared 0-1 bins) must exceed max(this, ambient x LOUD_NOISE_FACTOR) */
    LOUD_NOISE_FLOOR: 0.03,
    LOUD_NOISE_FACTOR: 5,
    /** Ambient level is learned over the first seconds of listening */
    AMBIENT_SAMPLES: 30,
    LEVEL_INTERVAL_MS: 100,
    /** Same kind of audio event at most once per this long */
    VIOLATION_TIMEOUT_MS: 8000,
    // YAMNet scores ~1 s windows; a class must clear its score in 2 of the last 3 windows.
    SPEECH_SCORE: 0.40,
    WHISPER_SCORE: 0.25,
    CONVERSATION_SCORE: 0.30,
    PHONE_SCORE: 0.35,
    WINDOW_SECONDS: 1,
    /** Microphone ended / muted by the OS / disabled for this long */
    MIC_OFF_MS: 4000,
};

const TASKS_AUDIO_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.0.1/wasm';
const YAMNET_MODEL = 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite';

// AudioSet labels emitted by YAMNet
const SPEECH_LABELS = new Set([
    'Speech', 'Narration, monologue', 'Babbling',
    'Male speech, man speaking', 'Female speech, woman speaking', 'Child speech, kid speaking',
]);
const WHISPER_LABELS = new Set(['Whispering']);
const CONVERSATION_LABELS = new Set(['Conversation']);
const VOICE_KINDS = ['Male speech, man speaking', 'Female speech, woman speaking', 'Child speech, kid speaking'];
const PHONE_LABELS = new Set(['Telephone', 'Telephone bell ringing', 'Ringtone', 'Telephone dialing, DTMF', 'Busy signal']);

// Audio is classified on-device with MediaPipe; no audio leaves the browser. When the classifier
// cannot load (offline, blocked CDN) a speech-band level detector still reports sustained talking.
export function useAudioProctoring(
    mediaStreamRef: React.MutableRefObject<MediaStream | null>,
    sessionMode: string | null,
    role: string | null,
    onViolation: (type: string, message: string) => void
) {
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyzerRef = useRef<AnalyserNode | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const classifierRef = useRef<AudioClassifier | null>(null);
    const analysedTrackRef = useRef<MediaStreamTrack | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const lastViolationTime = useRef<Record<string, number>>({});
    const recentHits = useRef<Array<Record<string, number>>>([]);
    // Callers pass an inline callback; keep the latest one without restarting the audio pipeline
    const onViolationRef = useRef(onViolation);
    onViolationRef.current = onViolation;

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;

        let isMounted = true;
        let classifierFailed = false;
        const ambient: number[] = [];
        let ambientEnergy = 0;
        let ambientSpeech = 0;
        const loud = new SustainedSignal(1000, 0.6, 15000, 6);
        const fallbackTalk = new SustainedSignal(1500, 0.65, 8000, 10);
        let micWasLive = false;
        let micLostSince = 0;
        let lastMicReport = 0;

        const loadClassifier = async () => {
            try {
                const { AudioClassifier, FilesetResolver } = await import('@mediapipe/tasks-audio');
                const fileset = await FilesetResolver.forAudioTasks(TASKS_AUDIO_WASM);
                const classifier = await AudioClassifier.createFromOptions(fileset, {
                    baseOptions: { modelAssetPath: YAMNET_MODEL },
                    maxResults: 8,
                    scoreThreshold: 0.15,
                });
                if (!isMounted) {
                    classifier.close();
                    return;
                }
                classifierRef.current = classifier;
            } catch (err) {
                classifierFailed = true;
                console.warn('[AudioProctoring] On-device audio classifier unavailable; using the speech-band level detector.', err);
            }
        };

        const reportOnce = (type: string, message: string) => {
            const now = Date.now();
            if (now - (lastViolationTime.current[type] || 0) < AUDIO_PROCTOR_CONFIG.VIOLATION_TIMEOUT_MS) return;
            lastViolationTime.current[type] = now;
            onViolationRef.current(type, message);
        };

        const classifyWindow = (samples: Float32Array, sampleRate: number) => {
            const classifier = classifierRef.current;
            if (!classifier) return;

            const scores: Record<string, number> = {};
            try {
                for (const result of classifier.classify(samples, sampleRate)) {
                    for (const category of result.classifications[0]?.categories || []) {
                        scores[category.categoryName] = Math.max(scores[category.categoryName] || 0, category.score);
                    }
                }
            } catch (err) {
                console.warn('[AudioProctoring] Classification failed:', err);
                return;
            }
            // The pet robot's own warning beeps are not the candidate talking
            if (audioProctoringSuppressed()) {
                recentHits.current = [];
                return;
            }

            recentHits.current = [...recentHits.current, scores].slice(-3);
            const windows = recentHits.current;
            const seenInTwo = (labels: Set<string>, min: number) =>
                windows.filter(w => Object.keys(w).some(label => labels.has(label) && w[label] >= min)).length >= 2;
            // Two different kinds of voice (e.g. a man and a woman) in the recent windows
            const voiceKinds = VOICE_KINDS.filter(kind => windows.some(w => (w[kind] || 0) >= AUDIO_PROCTOR_CONFIG.CONVERSATION_SCORE)).length;

            if (seenInTwo(PHONE_LABELS, AUDIO_PROCTOR_CONFIG.PHONE_SCORE)) reportOnce('phone_audio', 'A phone ringing or dialing was heard — please switch your phone off.');
            if (seenInTwo(CONVERSATION_LABELS, AUDIO_PROCTOR_CONFIG.CONVERSATION_SCORE) || (voiceKinds >= 2 && seenInTwo(SPEECH_LABELS, AUDIO_PROCTOR_CONFIG.SPEECH_SCORE))) {
                reportOnce('multiple_voices', 'More than one voice (a conversation) was heard — no one may talk to you during the exam.');
            } else if (seenInTwo(WHISPER_LABELS, AUDIO_PROCTOR_CONFIG.WHISPER_SCORE)) {
                reportOnce('whisper_detected', 'Whispering detected — please stay silent during the exam.');
            } else if (seenInTwo(SPEECH_LABELS, AUDIO_PROCTOR_CONFIG.SPEECH_SCORE)) {
                reportOnce('voice_detected', 'Talking detected — please stay silent during the exam.');
            }
        };

        const teardownAudio = () => {
            if (processorRef.current) {
                processorRef.current.onaudioprocess = null;
                processorRef.current = null;
            }
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(() => {});
                audioContextRef.current = null;
            }
            analyzerRef.current = null;
            analysedTrackRef.current = null;
            recentHits.current = [];
        };

        const initAudioAnalysis = (track: MediaStreamTrack) => {
            try {
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const analyzer = audioCtx.createAnalyser();
                analyzer.fftSize = 256;

                const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
                source.connect(analyzer);

                // Collect ~1s windows of raw samples for the classifier
                const processor = audioCtx.createScriptProcessor(4096, 1, 1);
                const windowLength = Math.round(audioCtx.sampleRate * AUDIO_PROCTOR_CONFIG.WINDOW_SECONDS);
                let windowBuffer = new Float32Array(windowLength);
                let filled = 0;
                processor.onaudioprocess = (event) => {
                    const input = event.inputBuffer.getChannelData(0);
                    let offset = 0;
                    while (offset < input.length) {
                        const count = Math.min(input.length - offset, windowLength - filled);
                        windowBuffer.set(input.subarray(offset, offset + count), filled);
                        filled += count;
                        offset += count;
                        if (filled === windowLength) {
                            classifyWindow(windowBuffer, audioCtx.sampleRate);
                            windowBuffer = new Float32Array(windowLength);
                            filled = 0;
                        }
                    }
                };
                // A ScriptProcessor only runs when connected to the destination; keep it silent
                const mute = audioCtx.createGain();
                mute.gain.value = 0;
                source.connect(processor);
                processor.connect(mute);
                mute.connect(audioCtx.destination);

                audioContextRef.current = audioCtx;
                analyzerRef.current = analyzer;
                processorRef.current = processor;
                analysedTrackRef.current = track;
            } catch (err) {
                console.error("[AudioProctoring] Failed to init AudioContext:", err);
            }
        };

        const checkMicrophone = (track: MediaStreamTrack | undefined, now: number) => {
            const usable = Boolean(track && track.readyState === 'live' && track.enabled && !track.muted);
            if (usable) {
                micWasLive = true;
                micLostSince = 0;
                return true;
            }
            if (!micWasLive) return false;
            if (!micLostSince) micLostSince = now;
            else if (now - micLostSince > AUDIO_PROCTOR_CONFIG.MIC_OFF_MS && now - lastMicReport > 30000) {
                lastMicReport = now;
                const why = !track ? 'no microphone' : track.readyState === 'ended' ? 'the microphone stopped' : track.muted ? 'the microphone was muted by the system' : 'the microphone was turned off';
                onViolationRef.current('mic_off', `Microphone unavailable (${why}) — please turn your microphone back on.`);
            }
            return false;
        };

        const tick = () => {
            if (!isMounted) return;
            const now = Date.now();
            const stream = mediaStreamRef.current;
            const track = stream?.getAudioTracks()[0];
            const usable = checkMicrophone(track, now);
            // Follow the live microphone track: a new stream or replaced track gets a fresh pipeline
            if (stream && track && usable && analysedTrackRef.current !== track) {
                teardownAudio();
                initAudioAnalysis(track);
            }
            const analyzer = analyzerRef.current;
            if (!analyzer || !usable) return;
            if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume().catch(() => {});

            const dataArray = new Uint8Array(analyzer.frequencyBinCount);
            analyzer.getByteFrequencyData(dataArray);
            let totalEnergy = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const value = dataArray[i] / 255.0;
                totalEnergy += value * value;
            }
            totalEnergy = totalEnergy / dataArray.length;
            // Speech band (~340-3400 Hz at fftSize 256 / 44.1-48 kHz)
            let speech = 0;
            for (let i = 2; i < 21; i++) speech += dataArray[i] / 255;
            speech /= 19;

            if (ambient.length < AUDIO_PROCTOR_CONFIG.AMBIENT_SAMPLES) {
                ambient.push(totalEnergy);
                ambientSpeech = Math.max(ambientSpeech, speech);
                if (ambient.length === AUDIO_PROCTOR_CONFIG.AMBIENT_SAMPLES) {
                    ambientEnergy = [...ambient].sort((a, b) => a - b)[Math.floor(ambient.length / 2)];
                }
                return;
            }
            if (audioProctoringSuppressed(now)) return;

            const loudThreshold = Math.max(AUDIO_PROCTOR_CONFIG.LOUD_NOISE_FLOOR, ambientEnergy * AUDIO_PROCTOR_CONFIG.LOUD_NOISE_FACTOR);
            if (loud.update(totalEnergy > loudThreshold, now)) {
                reportOnce('suspicious_noise', 'Loud noise detected — please make sure your room is quiet.');
            }
            // Without the classifier, sustained speech-band sound above the room level counts as talking
            if (classifierFailed || !classifierRef.current) {
                const talkThreshold = Math.max(16 / 255, ambientSpeech + 12 / 255);
                if (fallbackTalk.update(speech > talkThreshold, now)) {
                    reportOnce('voice_detected', 'Talking detected — please stay silent during the exam.');
                }
            }
        };

        loadClassifier();
        timerRef.current = setInterval(tick, AUDIO_PROCTOR_CONFIG.LEVEL_INTERVAL_MS);

        return () => {
            isMounted = false;
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
            teardownAudio();
            classifierRef.current?.close();
            classifierRef.current = null;
        };
    }, [sessionMode, role, mediaStreamRef]);
}
