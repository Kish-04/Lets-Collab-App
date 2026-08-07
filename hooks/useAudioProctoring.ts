import { useEffect, useRef } from 'react';

const AUDIO_PROCTOR_CONFIG = {
    LOUD_NOISE_THRESHOLD: 0.02,
    NOISE_TIMEOUT_MS: 5000,
};

export function useAudioProctoring(
    mediaStreamRef: React.MutableRefObject<MediaStream | null>,
    sessionMode: string | null,
    role: string | null,
    onViolation: (type: string, message: string) => void
) {
    const recognitionRef = useRef<any>(null);
    const isListeningRef = useRef<boolean>(false);
    
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyzerRef = useRef<AnalyserNode | null>(null);
    const requestRef = useRef<number>(0);
    const initializedAudioRef = useRef<boolean>(false);
    
    const lastViolationTime = useRef<number>(0);

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;

        let isMounted = true;

        const initAudioAnalysis = (stream: MediaStream) => {
            if (initializedAudioRef.current) return;
            if (stream.getAudioTracks().length === 0) return;
            
            try {
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const analyzer = audioCtx.createAnalyser();
                analyzer.fftSize = 256;
                
                const source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyzer);

                audioContextRef.current = audioCtx;
                analyzerRef.current = analyzer;
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
                if (now - lastViolationTime.current > AUDIO_PROCTOR_CONFIG.NOISE_TIMEOUT_MS) {
                    onViolation('suspicious_noise', "Loud background noise detected. Please ensure a quiet environment.");
                    lastViolationTime.current = now;
                }
            }

            requestRef.current = requestAnimationFrame(processAudio);
        };


        const initSpeechRecognition = () => {
            if (isListeningRef.current) return;
            if (!mediaStreamRef.current || mediaStreamRef.current.getAudioTracks().length === 0) return;

            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            
            if (!SpeechRecognition) {
                return;
            }

            try {
                const recognition = new SpeechRecognition();
                recognition.continuous = true; 
                recognition.interimResults = true; 
                recognition.lang = 'en-US';

                recognition.onresult = (event: any) => {
                    const now = Date.now();
                    if (now - lastViolationTime.current > 5000) {
                        onViolation('voice_detected', "Human speech detected. Please remain silent.");
                        lastViolationTime.current = now;
                    }
                };

                recognition.onerror = (event: any) => {
                    if (event.error !== 'no-speech') {
                        console.warn("[AudioProctoring] Speech recognition error:", event.error);
                    }
                };

                recognition.onend = () => {
                    if (isMounted) {
                        try {
                            recognition.start();
                        } catch (e) {}
                    }
                };

                recognition.start();
                recognitionRef.current = recognition;
                isListeningRef.current = true;
            } catch (err) {
                console.error("[AudioProctoring] Failed to init SpeechRecognition:", err);
            }
        };

        const checkStreamInterval = setInterval(() => {
            if (!isListeningRef.current && mediaStreamRef.current) {
                initSpeechRecognition();
            }
        }, 1000);

        requestRef.current = requestAnimationFrame(processAudio);

        return () => {
            isMounted = false;
            clearInterval(checkStreamInterval);
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(console.error);
                audioContextRef.current = null;
            }

            if (recognitionRef.current) {
                try {
                    recognitionRef.current.onend = null;
                    recognitionRef.current.stop();
                } catch (e) {}
                recognitionRef.current = null;
            }
            isListeningRef.current = false;
        };
    }, [sessionMode, role, mediaStreamRef, onViolation]);
}

