import { useEffect, useRef } from 'react';
import type { AudioClassifier } from '@mediapipe/tasks-audio';

const AUDIO_PROCTOR_CONFIG = {
    LOUD_NOISE_THRESHOLD: 0.02,
    NOISE_TIMEOUT_MS: 5000,
    VIOLATION_TIMEOUT_MS: 5000,
    // YAMNet scores ~1s windows; a category must score this high in 2 of the last 3 windows
    CLASS_SCORE_THRESHOLD: 0.5,
    WINDOW_SECONDS: 1,
};

const TASKS_AUDIO_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.0.1/wasm';
const YAMNET_MODEL = 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite';

// AudioSet labels emitted by YAMNet
const SPEECH_LABELS = new Set([
    'Speech', 'Conversation', 'Narration, monologue', 'Babbling',
    'Male speech, man speaking', 'Female speech, woman speaking', 'Child speech, kid speaking',
]);
const WHISPER_LABELS = new Set(['Whispering']);
const PHONE_LABELS = new Set(['Telephone', 'Telephone bell ringing', 'Ringtone', 'Telephone dialing, DTMF']);

// Audio is classified on-device with MediaPipe; no audio leaves the browser.
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
    const requestRef = useRef<number>(0);
    const initializedAudioRef = useRef<boolean>(false);

    const lastNoiseTime = useRef<number>(0);
    const lastViolationTime = useRef<number>(0);
    const recentHits = useRef<string[][]>([]);
    // Callers pass an inline callback; keep the latest one without restarting the audio pipeline
    const onViolationRef = useRef(onViolation);
    onViolationRef.current = onViolation;

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;

        let isMounted = true;

        const loadClassifier = async () => {
            try {
                const { AudioClassifier, FilesetResolver } = await import('@mediapipe/tasks-audio');
                const fileset = await FilesetResolver.forAudioTasks(TASKS_AUDIO_WASM);
                const classifier = await AudioClassifier.createFromOptions(fileset, {
                    baseOptions: { modelAssetPath: YAMNET_MODEL },
                    maxResults: 5,
                    scoreThreshold: 0.2,
                });
                if (!isMounted) {
                    classifier.close();
                    return;
                }
                classifierRef.current = classifier;
            } catch (err) {
                console.warn('[AudioProctoring] On-device audio classifier unavailable; using loudness only.', err);
            }
        };

        const reportOnce = (type: string, message: string) => {
            const now = Date.now();
            if (now - lastViolationTime.current < AUDIO_PROCTOR_CONFIG.VIOLATION_TIMEOUT_MS) return;
            lastViolationTime.current = now;
            onViolationRef.current(type, message);
        };

        const classifyWindow = (samples: Float32Array, sampleRate: number) => {
            const classifier = classifierRef.current;
            if (!classifier) return;

            const labels: string[] = [];
            try {
                for (const result of classifier.classify(samples, sampleRate)) {
                    for (const category of result.classifications[0]?.categories || []) {
                        if (category.score >= AUDIO_PROCTOR_CONFIG.CLASS_SCORE_THRESHOLD) labels.push(category.categoryName);
                    }
                }
            } catch (err) {
                console.warn('[AudioProctoring] Classification failed:', err);
                return;
            }

            recentHits.current = [...recentHits.current, labels].slice(-3);
            const seenInTwo = (set: Set<string>) =>
                recentHits.current.filter(window => window.some(label => set.has(label))).length >= 2;

            if (seenInTwo(PHONE_LABELS)) reportOnce('phone_audio', 'Phone ringing or dialing detected.');
            else if (seenInTwo(WHISPER_LABELS)) reportOnce('whisper_detected', 'Whispering detected. Please remain silent.');
            else if (seenInTwo(SPEECH_LABELS)) reportOnce('voice_detected', 'Human speech detected. Please remain silent.');
        };

        const initAudioAnalysis = (stream: MediaStream) => {
            if (initializedAudioRef.current) return;
            if (stream.getAudioTracks().length === 0) return;

            try {
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const analyzer = audioCtx.createAnalyser();
                analyzer.fftSize = 256;

                const source = audioCtx.createMediaStreamSource(stream);
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
                initializedAudioRef.current = true;
            } catch (err) {
                console.error("[AudioProctoring] Failed to init AudioContext:", err);
            }
        };

        const processAudio = () => {
            if (!isMounted) return;
            if (!initializedAudioRef.current && mediaStreamRef.current) {
                initAudioAnalysis(mediaStreamRef.current);
            }
            if (!analyzerRef.current) {
                requestRef.current = requestAnimationFrame(processAudio);
                return;
            }

            const bufferLength = analyzerRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyzerRef.current.getByteFrequencyData(dataArray);

            let totalEnergy = 0;
            for (let i = 0; i < bufferLength; i++) {
                const value = dataArray[i] / 255.0;
                totalEnergy += value * value;
            }
            totalEnergy = totalEnergy / bufferLength;

            const now = Date.now();
            if (totalEnergy > AUDIO_PROCTOR_CONFIG.LOUD_NOISE_THRESHOLD) {
                if (now - lastNoiseTime.current > AUDIO_PROCTOR_CONFIG.NOISE_TIMEOUT_MS) {
                    onViolationRef.current('suspicious_noise', "Loud background noise detected. Please ensure a quiet environment.");
                    lastNoiseTime.current = now;
                }
            }

            requestRef.current = requestAnimationFrame(processAudio);
        };

        loadClassifier();
        requestRef.current = requestAnimationFrame(processAudio);

        return () => {
            isMounted = false;
            if (requestRef.current) cancelAnimationFrame(requestRef.current);

            if (processorRef.current) {
                processorRef.current.onaudioprocess = null;
                processorRef.current = null;
            }
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(console.error);
                audioContextRef.current = null;
            }
            analyzerRef.current = null;
            initializedAudioRef.current = false;
            recentHits.current = [];

            classifierRef.current?.close();
            classifierRef.current = null;
        };
    }, [sessionMode, role, mediaStreamRef]);
}
