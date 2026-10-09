export type VoiceFilter = 'none' | 'robot' | 'alien' | 'radio' | 'megaphone' | 'deep' | 'chipmunk' | 'echo' | 'male' | 'female';

// Granular pitch shifter: two read heads sweep a short delay line at `pitch` speed and are
// crossfaded with sin^2 windows (which sum to 1) so the wrap-around jumps are inaudible.
const PITCH_SHIFT_PROCESSOR = `
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.grain = 2048;
    this.size = 8192;
    this.buffer = new Float32Array(this.size);
    this.write = 0;
    this.delay = 0;
  }
  read(pos) {
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = this.buffer[i & (this.size - 1)];
    const b = this.buffer[(i + 1) & (this.size - 1)];
    return a + (b - a) * frac;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0];
    if (!output || !output.length) return true;
    const pitch = parameters.pitch[0];
    const grain = this.grain;
    for (let n = 0; n < output[0].length; n++) {
      this.buffer[this.write] = input ? input[n] : 0;
      const d1 = this.delay;
      const d2 = (d1 + grain / 2) % grain;
      const g1 = Math.sin(Math.PI * d1 / grain) ** 2;
      const g2 = Math.sin(Math.PI * d2 / grain) ** 2;
      const base = this.write + this.size - 1;
      const sample = this.read(base - d1) * g1 + this.read(base - d2) * g2;
      for (let c = 0; c < output.length; c++) output[c][n] = sample;
      this.write = (this.write + 1) & (this.size - 1);
      this.delay = ((this.delay + 1 - pitch) % grain + grain) % grain;
    }
    return true;
  }
}
registerProcessor('pitch-shift-processor', PitchShiftProcessor);
`;

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
    private highShelfFilter: BiquadFilterNode;
    private pitchNode: AudioWorkletNode | null = null;
    private pitchReady: Promise<boolean>;
    private routeId = 0;

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
        this.highShelfFilter = this.context.createBiquadFilter();

        // Start oscillator for ring mod (AM Synthesis)
        this.ringModulator.start();
        this.pitchReady = this.loadPitchShifter();
    }

    private async loadPitchShifter(): Promise<boolean> {
        if (!this.context.audioWorklet) return false;
        const url = URL.createObjectURL(new Blob([PITCH_SHIFT_PROCESSOR], { type: 'application/javascript' }));
        try {
            await this.context.audioWorklet.addModule(url);
            this.pitchNode = new AudioWorkletNode(this.context, 'pitch-shift-processor');
            return true;
        } catch (err) {
            console.warn('[VoiceChanger] Pitch shifter unavailable, using filters only.', err);
            return false;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // Connects the mic source to the start of an effect chain, inserting the pitch shifter once it has loaded.
    // Until then (or if worklets are unavailable) the chain runs without pitch shifting.
    private connectSource(entry: AudioNode, pitchRatio = 1) {
        const source = this.source;
        if (!source) return;
        source.connect(entry);
        if (pitchRatio === 1) return;

        const routeId = this.routeId;
        this.pitchReady.then((ready) => {
            if (!ready || !this.pitchNode || routeId !== this.routeId || source !== this.source) return;
            this.pitchNode.parameters.get('pitch')?.setValueAtTime(pitchRatio, this.context.currentTime);
            source.disconnect();
            source.connect(this.pitchNode);
            this.pitchNode.connect(entry);
        });
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
        this.highShelfFilter.disconnect();
        this.pitchNode?.disconnect();
        this.source.disconnect();
        this.routeId += 1;

        if (filterType === 'none') {
            this.source.connect(this.destination);
            const processedStream = new MediaStream();
            this.destination.stream.getAudioTracks().forEach(track => processedStream.addTrack(track));
            stream.getVideoTracks().forEach(track => processedStream.addTrack(track));
            return processedStream;
        }

        if (filterType === 'robot') {
            // Ring Modulation for Robotic effect
            this.ringModulator.type = 'sawtooth';
            this.ringModulator.frequency.value = 50;

            this.source.connect(this.ringModGain);
            this.ringModulator.connect(this.ringModGain.gain);
            
            this.ringModGain.connect(this.outputGain);
            this.outputGain.gain.value = 1.2; // Adjusted volume
            this.outputGain.connect(this.destination);
        } else if (filterType === 'alien') {
            this.ringModulator.type = 'sine';
            this.ringModulator.frequency.value = 800;

            this.source.connect(this.ringModGain);
            this.ringModulator.connect(this.ringModGain.gain);
            
            this.ringModGain.connect(this.outputGain);
            this.outputGain.gain.value = 1.2;
            this.outputGain.connect(this.destination);
        } else if (filterType === 'radio') {
            // Highpass and Lowpass to simulate a bad radio
            this.filter.type = 'bandpass';
            this.filter.frequency.value = 1500;
            this.filter.Q.value = 2.0;

            this.source.connect(this.filter);
            this.filter.connect(this.outputGain);
            this.outputGain.gain.value = 2.0;
            this.outputGain.connect(this.destination);
        } else if (filterType === 'megaphone') {
            this.filter.type = 'bandpass';
            this.filter.frequency.value = 1800;
            this.filter.Q.value = 1.6;
            this.distortionNode.curve = this.createDistortionCurve(180);
            this.distortionNode.oversample = '2x';
            this.outputGain.gain.value = 1.2;

            this.source.connect(this.filter);
            this.filter.connect(this.distortionNode);
            this.distortionNode.connect(this.outputGain);
            this.outputGain.connect(this.destination);
        } else if (filterType === 'deep') {
            // Pitch down ~6 semitones with a bass boost
            this.filter.type = 'lowshelf';
            this.filter.frequency.value = 250;
            this.filter.gain.value = 6;

            this.connectSource(this.filter, 0.7);
            this.filter.connect(this.outputGain);
            this.outputGain.gain.value = 1.3;
            this.outputGain.connect(this.destination);
        } else if (filterType === 'chipmunk') {
            // Pitch up ~9 semitones, trimming low rumble
            this.filter.type = 'highpass';
            this.filter.frequency.value = 200;

            this.connectSource(this.filter, 1.7);
            this.filter.connect(this.outputGain);
            this.outputGain.gain.value = 1.2;
            this.outputGain.connect(this.destination);
        } else if (filterType === 'echo') {
            // Classic delay/echo effect
            this.delayNode.delayTime.value = 0.3; // 300ms delay
            this.feedbackGain.gain.value = 0.4;   // 40% feedback

            this.source.connect(this.outputGain); // Direct sound
            this.source.connect(this.delayNode);   // Into delay
            this.delayNode.connect(this.feedbackGain);
            this.feedbackGain.connect(this.delayNode); // Feedback loop
            this.delayNode.connect(this.outputGain);  // Delayed sound to output
            
            this.outputGain.gain.value = 1.1;
            this.outputGain.connect(this.destination);
        } else if (filterType === 'male') {
            // Boost low frequencies (formants) to simulate a deeper male voice
            this.filter.type = 'lowshelf';
            this.filter.frequency.value = 200;
            this.filter.gain.value = 10; // Boost bass

            this.connectSource(this.filter, 0.85);
            this.filter.connect(this.outputGain);
            this.outputGain.gain.value = 1.0;
            this.outputGain.connect(this.destination);
        } else if (filterType === 'female') {
            // Boost high frequencies and cut lows for a higher pitched simulation
            this.filter.type = 'highpass';
            this.filter.frequency.value = 300;
            
            this.highShelfFilter.type = 'highshelf';
            this.highShelfFilter.frequency.value = 2500;
            this.highShelfFilter.gain.value = 8; // Boost highs

            this.connectSource(this.filter, 1.2);
            this.filter.connect(this.highShelfFilter);
            this.highShelfFilter.connect(this.outputGain);
            
            this.outputGain.gain.value = 1.0;
            this.outputGain.connect(this.destination);
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
