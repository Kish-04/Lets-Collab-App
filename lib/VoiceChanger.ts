export type VoiceFilter = 'none' | 'robot' | 'alien' | 'radio' | 'megaphone' | 'deep' | 'chipmunk' | 'echo' | 'male' | 'female';

export class VoiceChanger {
    private context: AudioContext;
    private source: MediaStreamAudioSourceNode | null = null;
    private destination: MediaStreamAudioDestinationNode;
    
    // Effect Nodes
    private filter: BiquadFilterNode;
    private ringModulator: OscillatorNode;
    private ringModGain: GainNode;
    private outputGain: GainNode;
    private delayNode: DelayNode;
    private feedbackGain: GainNode;
    private distortionNode: WaveShaperNode;

    constructor() {
        this.context = new window.AudioContext();
        this.destination = this.context.createMediaStreamDestination();
        
        // Initialize Nodes
        this.filter = this.context.createBiquadFilter();
        this.ringModulator = this.context.createOscillator();
        this.ringModGain = this.context.createGain();
        this.outputGain = this.context.createGain();
        this.delayNode = this.context.createDelay();
        this.feedbackGain = this.context.createGain();
        this.distortionNode = this.context.createWaveShaper();

        // Start oscillator for ring mod (AM Synthesis)
        this.ringModulator.start();
    }

    public processStream(stream: MediaStream, filterType: VoiceFilter): MediaStream {
        if (this.context.state === 'suspended') {
            this.context.resume();
        }
        // Disconnect old source
        if (this.source) {
            this.source.disconnect();
        }

        // Only process if there is an audio track
        if (stream.getAudioTracks().length === 0) return stream;

        this.source = this.context.createMediaStreamSource(stream);

        // Reset all routings
        this.filter.disconnect();
        this.ringModulator.disconnect();
        this.ringModGain.disconnect();
        this.outputGain.disconnect();
        this.delayNode.disconnect();
        this.feedbackGain.disconnect();
        this.distortionNode.disconnect();
        this.source.disconnect();

        if (filterType === 'none') {
            this.source.connect(this.destination);
            return this.destination.stream;
        }

        if (filterType === 'robot') {
            // Ring Modulation for Robotic effect
            this.ringModulator.type = 'sawtooth';
            this.ringModulator.frequency.value = 50;

            this.source.connect(this.ringModGain);
            this.ringModulator.connect(this.ringModGain.gain);
            
            this.ringModGain.connect(this.outputGain);
            this.outputGain.gain.value = 2.0; // Boost volume
            this.outputGain.connect(this.destination);
        } else if (filterType === 'alien') {
            this.ringModulator.type = 'sine';
            this.ringModulator.frequency.value = 800;

            this.source.connect(this.ringModGain);
            this.ringModulator.connect(this.ringModGain.gain);
            
            this.ringModGain.connect(this.destination);
        } else if (filterType === 'radio') {
            // Highpass and Lowpass to simulate a bad radio
            this.filter.type = 'bandpass';
            this.filter.frequency.value = 1500;
            this.filter.Q.value = 2.0;

            this.source.connect(this.filter);
            this.filter.connect(this.destination);
        } else if (filterType === 'megaphone') {
            this.filter.type = 'bandpass';
            this.filter.frequency.value = 1800;
            this.filter.Q.value = 1.6;
            this.distortionNode.curve = this.createDistortionCurve(180);
            this.distortionNode.oversample = '2x';
            this.outputGain.gain.value = 1.35;

            this.source.connect(this.filter);
            this.filter.connect(this.distortionNode);
            this.distortionNode.connect(this.outputGain);
            this.outputGain.connect(this.destination);
        } else if (filterType === 'deep') {
            // Simple lowpass + slight AM synthesis
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 400;

            this.ringModulator.type = 'sine';
            this.ringModulator.frequency.value = 30;

            this.source.connect(this.filter);
            this.filter.connect(this.ringModGain);
            this.ringModulator.connect(this.ringModGain.gain);
            
            this.ringModGain.connect(this.outputGain);
            this.outputGain.gain.value = 1.5;
            this.outputGain.connect(this.destination);
        } else if (filterType === 'chipmunk') {
            // Highpass filter + high freq ring mod for squeaky effect
            this.filter.type = 'highpass';
            this.filter.frequency.value = 800;

            this.ringModulator.type = 'square';
            this.ringModulator.frequency.value = 800;

            this.source.connect(this.filter);
            this.filter.connect(this.ringModGain);
            this.ringModulator.connect(this.ringModGain.gain);
            
            this.ringModGain.connect(this.outputGain);
            this.outputGain.gain.value = 1.2;
            this.outputGain.connect(this.destination);
        } else if (filterType === 'echo') {
            // Classic delay/echo effect
            this.delayNode.delayTime.value = 0.3; // 300ms delay
            this.feedbackGain.gain.value = 0.4;   // 40% feedback

            this.source.connect(this.destination); // Direct sound
            this.source.connect(this.delayNode);   // Into delay
            this.delayNode.connect(this.feedbackGain);
            this.feedbackGain.connect(this.delayNode); // Feedback loop
            this.delayNode.connect(this.destination);  // Delayed sound to output
        } else if (filterType === 'male') {
            // Boost low frequencies (formants) to simulate a deeper male voice
            this.filter.type = 'lowshelf';
            this.filter.frequency.value = 200;
            this.filter.gain.value = 10; // Boost bass

            this.source.connect(this.filter);
            this.filter.connect(this.destination);
        } else if (filterType === 'female') {
            // Boost high frequencies and cut lows for a higher pitched simulation
            this.filter.type = 'highpass';
            this.filter.frequency.value = 300;
            
            // We can chain another filter using the output gain as a bridge
            this.ringModGain.disconnect();
            
            const highShelf = this.context.createBiquadFilter();
            highShelf.type = 'highshelf';
            highShelf.frequency.value = 2500;
            highShelf.gain.value = 8; // Boost highs

            this.source.connect(this.filter);
            this.filter.connect(highShelf);
            highShelf.connect(this.destination);
        }

        // Return the modified audio stream combined with the original video tracks
        const processedStream = new MediaStream();
        this.destination.stream.getAudioTracks().forEach(track => processedStream.addTrack(track));
        stream.getVideoTracks().forEach(track => processedStream.addTrack(track));

        return processedStream;
    }

    private createDistortionCurve(amount: number) {
        const samples = 44100;
        const curve = new Float32Array(samples);
        const deg = Math.PI / 180;

        for (let i = 0; i < samples; i += 1) {
            const x = (i * 2) / samples - 1;
            curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }

        return curve;
    }

    public stop() {
        this.context.close();
    }
}
