export const VOICE_FILTER_OPTIONS = [
    { id: 'none', label: 'Normal Voice' },
    { id: 'deep', label: 'Deep / Witness Protection' },
    { id: 'male', label: 'Lower (masculine)' },
    { id: 'female', label: 'Higher (feminine)' },
    { id: 'child', label: 'Child' },
    { id: 'chipmunk', label: 'Chipmunk' },
    { id: 'monster', label: 'Monster' },
    { id: 'robot', label: 'Robot' },
    { id: 'alien', label: 'Alien' },
    { id: 'radio', label: 'Radio' },
    { id: 'megaphone', label: 'Megaphone' },
    { id: 'echo', label: 'Canyon Echo' },
    { id: 'hall', label: 'Concert Hall' },
] as const;

export type VoiceFilter = (typeof VOICE_FILTER_OPTIONS)[number]['id'];

// Noise gate: an RMS follower with hysteresis and hold, so breaths and keyboard noise between words
// are pulled down (not hard-muted) without chopping the start or tail of words.
const VOICE_GATE_PROCESSOR = `
class VoiceGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -52, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'floor', defaultValue: 0.12, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    const sr = typeof sampleRate === 'number' ? sampleRate : 48000;
    this.envCoef = 1 - Math.exp(-1 / (0.012 * sr));
    this.attack = 1 - Math.exp(-1 / (0.002 * sr));
    this.release = 1 - Math.exp(-1 / (0.09 * sr));
    this.holdSamples = Math.round(0.15 * sr);
    this.env = 0;
    this.gain = 0;
    this.hold = 0;
    this.open = false;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0];
    if (!output || !output.length) return true;
    const threshold = parameters.threshold ? parameters.threshold[0] : -52;
    const floor = parameters.floor ? parameters.floor[0] : 0.12;
    for (let n = 0; n < output[0].length; n++) {
      const x = input ? input[n] : 0;
      this.env += (x * x - this.env) * this.envCoef;
      const level = 10 * Math.log10(this.env + 1e-12);
      if (level > threshold) { this.open = true; this.hold = this.holdSamples; }
      else if (level < threshold - 6) {
        if (this.hold > 0) this.hold--; else this.open = false;
      }
      const target = this.open ? 1 : floor;
      this.gain += (target - this.gain) * (target > this.gain ? this.attack : this.release);
      const y = x * this.gain;
      for (let c = 0; c < output.length; c++) output[c][n] = y;
    }
    return true;
  }
}
registerProcessor('voice-gate-processor', VoiceGateProcessor);
`;

// Phase-vocoder pitch shifter (STFT, 75% overlap, true-frequency estimation per bin), so voices are
// shifted without the comb/"robot" artefacts of a two-tap delay line. With preserve = 1 the spectral
// envelope (the formants that make a voice sound human) is kept or moved independently by
// `formant`, which avoids the chipmunk effect; preserve = 0 gives the classic chipmunk shift.
const PITCH_SHIFT_PROCESSOR = `
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
      { name: 'formant', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
      { name: 'preserve', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    const sr = typeof sampleRate === 'number' ? sampleRate : 48000;
    const N = sr > 32000 ? 2048 : 1024;
    this.N = N;
    this.half = N / 2;
    this.osamp = 4;
    this.hop = N / this.osamp;
    this.latency = N - this.hop;
    this.rover = this.latency;
    this.binHz = sr / N;
    this.expected = (2 * Math.PI * this.hop) / N;
    this.window = new Float32Array(N);
    for (let i = 0; i < N; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    this.inFifo = new Float32Array(N);
    this.outFifo = new Float32Array(N);
    this.accum = new Float32Array(N * 2);
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
    const bins = this.half + 1;
    this.lastPhase = new Float64Array(bins);
    this.sumPhase = new Float64Array(bins);
    this.anaMag = new Float64Array(bins);
    this.anaFreq = new Float64Array(bins);
    this.synMag = new Float64Array(bins);
    this.synFreq = new Float64Array(bins);
    this.logMag = new Float64Array(bins);
    this.env = new Float64Array(bins);
    this.tmp = new Float64Array(bins);
    this.envRadius = Math.max(2, Math.round(260 / this.binHz));
    // Overlap-add of Hann analysis + synthesis windows at 75% overlap sums to 1.5
    this.olaScale = 1 / 1.5;
    this.bitrev = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.bitrev[i] = r;
    }
    this.cos = new Float64Array(N / 2);
    this.sin = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / N); this.sin[i] = Math.sin((2 * Math.PI * i) / N); }
  }
  fft(inverse) {
    const N = this.N, re = this.re, im = this.im, rev = this.bitrev;
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= N; size <<= 1) {
      const halfSize = size >> 1, step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < halfSize; k++) {
          const wr = this.cos[k * step], wi = sign * this.sin[k * step];
          const a = start + k, b = a + halfSize;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
  smoothEnvelope() {
    // Two box-filter passes over log magnitude ~ triangular smoothing across a few harmonics
    const bins = this.half + 1, r = this.envRadius;
    let src = this.logMag, dst = this.tmp;
    for (let pass = 0; pass < 2; pass++) {
      let sum = 0, count = 0;
      for (let i = 0; i <= Math.min(r, bins - 1); i++) { sum += src[i]; count++; }
      for (let k = 0; k < bins; k++) {
        dst[k] = sum / count;
        const add = k + r + 1, remove = k - r;
        if (add < bins) { sum += src[add]; count++; }
        if (remove >= 0) { sum -= src[remove]; count--; }
      }
      src = dst; dst = pass === 0 ? this.env : this.tmp;
    }
    // After two passes the result is in this.env
  }
  envAt(bin) {
    if (bin <= 0) return this.env[0];
    if (bin >= this.half) return this.env[this.half];
    const i = Math.floor(bin), f = bin - i;
    return this.env[i] + (this.env[i + 1] - this.env[i]) * f;
  }
  processFrame(pitch, formant, preserve) {
    const N = this.N, half = this.half, re = this.re, im = this.im;
    for (let i = 0; i < N; i++) { re[i] = this.inFifo[i] * this.window[i]; im[i] = 0; }
    this.fft(false);
    for (let k = 0; k <= half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const phase = Math.atan2(im[k], re[k]);
      let delta = phase - this.lastPhase[k] - k * this.expected;
      this.lastPhase[k] = phase;
      delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
      this.anaMag[k] = mag;
      this.anaFreq[k] = k + (delta * this.osamp) / (2 * Math.PI);
      this.logMag[k] = Math.log(mag + 1e-9);
      this.synMag[k] = 0;
      this.synFreq[k] = 0;
    }
    if (preserve) this.smoothEnvelope();
    for (let k = 0; k <= half; k++) {
      const j = Math.round(k * pitch);
      if (j > half) break;
      let mag = this.anaMag[k];
      if (preserve) {
        let g = this.envAt(j / formant) - this.env[k];
        if (g > 1.6) g = 1.6; else if (g < -3) g = -3;
        mag *= Math.exp(g);
      }
      if (mag > this.synMag[j]) this.synFreq[j] = this.anaFreq[k] * pitch;
      this.synMag[j] += mag;
    }
    for (let k = 0; k < N; k++) { re[k] = 0; im[k] = 0; }
    for (let k = 0; k <= half; k++) {
      const delta = ((this.synFreq[k] - k) * 2 * Math.PI) / this.osamp;
      this.sumPhase[k] += k * this.expected + delta;
      const phase = this.sumPhase[k];
      const scale = k === 0 || k === half ? 1 : 2;
      re[k] = this.synMag[k] * Math.cos(phase) * scale;
      im[k] = this.synMag[k] * Math.sin(phase) * scale;
    }
    // Keep accumulated phases bounded
    for (let k = 0; k <= half; k++) this.sumPhase[k] %= 2 * Math.PI;
    this.fft(true);
    const norm = this.olaScale / N;
    for (let i = 0; i < N; i++) this.accum[i] += this.window[i] * re[i] * norm;
    for (let i = 0; i < this.hop; i++) this.outFifo[i] = this.accum[i];
    this.accum.copyWithin(0, this.hop, this.hop + N);
    this.accum.fill(0, N);
    this.inFifo.copyWithin(0, this.hop, N);
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0];
    if (!output || !output.length) return true;
    const pitch = parameters.pitch ? parameters.pitch[0] : 1;
    const formant = parameters.formant ? parameters.formant[0] : 1;
    const preserve = parameters.preserve ? parameters.preserve[0] >= 0.5 : true;
    for (let n = 0; n < output[0].length; n++) {
      this.inFifo[this.rover] = input ? input[n] : 0;
      const y = this.outFifo[this.rover - this.latency];
      for (let c = 0; c < output.length; c++) output[c][n] = y;
      this.rover++;
      if (this.rover >= this.N) {
        this.rover = this.latency;
        this.processFrame(pitch, formant, preserve);
      }
    }
    return true;
  }
}
registerProcessor('pitch-shift-processor', PitchShiftProcessor);
`;

interface Preset {
    pitch?: number;
    formant?: number;
    preserve?: boolean;
    gate?: number;
    makeup?: number;
    fx?: (ctx: AudioContext, input: AudioNode, output: AudioNode, keep: (n: AudioNode) => void) => void;
}

const filter = (ctx: AudioContext, type: BiquadFilterType, frequency: number, q = 0.707, gain = 0) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
};

function chain(nodes: AudioNode[]) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

function saturator(ctx: AudioContext, drive: number) {
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    return shaper;
}

// Ring modulation (input x carrier) mixed with the dry signal
function ringMod(ctx: AudioContext, input: AudioNode, output: AudioNode, keep: (n: AudioNode) => void, frequency: number, wet: number, type: OscillatorType = 'sine') {
    const carrier = ctx.createOscillator();
    carrier.type = type;
    carrier.frequency.value = frequency;
    const modulated = ctx.createGain();
    modulated.gain.value = 0;
    carrier.connect(modulated.gain);
    carrier.start();
    const wetGain = ctx.createGain();
    wetGain.gain.value = wet;
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - wet;
    input.connect(modulated);
    modulated.connect(wetGain).connect(output);
    input.connect(dryGain).connect(output);
    [carrier, modulated, wetGain, dryGain].forEach(keep);
}

function impulseResponse(ctx: AudioContext, seconds: number, decay: number) {
    const length = Math.round(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < length; i++) {
            const t = i / length;
            // Diffuse noise tail with a short pre-delay and a darker end
            data[i] = i < ctx.sampleRate * 0.012 ? 0 : (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - 0.5 * t);
        }
    }
    return buffer;
}

const PRESETS: Record<Exclude<VoiceFilter, 'none'>, Preset> = {
    deep: {
        pitch: 0.72, formant: 0.84,
        fx: (ctx, i, o, keep) => { const shelf = filter(ctx, 'lowshelf', 220, 0.707, 3); keep(shelf); chain([i, shelf, o]); },
    },
    male: { pitch: 0.82, formant: 0.9 },
    female: {
        pitch: 1.38, formant: 1.16,
        fx: (ctx, i, o, keep) => { const hp = filter(ctx, 'highpass', 140); const air = filter(ctx, 'highshelf', 4500, 0.707, 2); [hp, air].forEach(keep); chain([i, hp, air, o]); },
    },
    child: {
        pitch: 1.55, formant: 1.28,
        fx: (ctx, i, o, keep) => { const hp = filter(ctx, 'highpass', 180); keep(hp); chain([i, hp, o]); },
    },
    chipmunk: { pitch: 1.8, preserve: false, fx: (ctx, i, o, keep) => { const hp = filter(ctx, 'highpass', 200); keep(hp); chain([i, hp, o]); } },
    monster: {
        pitch: 0.58, formant: 0.7, makeup: 1.1,
        fx: (ctx, i, o, keep) => {
            const shelf = filter(ctx, 'lowshelf', 180, 0.707, 5);
            const drive = saturator(ctx, 2.2);
            const lp = filter(ctx, 'lowpass', 5000);
            [shelf, drive, lp].forEach(keep);
            chain([i, shelf, drive, lp, o]);
        },
    },
    robot: {
        fx: (ctx, i, o, keep) => {
            const mid = ctx.createGain();
            keep(mid);
            ringMod(ctx, i, mid, keep, 95, 0.7);
            // Short metallic comb filter
            const comb = ctx.createDelay(0.05);
            comb.delayTime.value = 0.0065;
            const feedback = ctx.createGain();
            feedback.gain.value = 0.5;
            const bp = filter(ctx, 'peaking', 1400, 1.2, 4);
            [comb, feedback, bp].forEach(keep);
            mid.connect(o);
            mid.connect(comb);
            comb.connect(feedback).connect(comb);
            comb.connect(bp).connect(o);
        },
    },
    alien: {
        pitch: 1.22, formant: 1.4,
        fx: (ctx, i, o, keep) => {
            const mid = ctx.createGain();
            keep(mid);
            ringMod(ctx, i, mid, keep, 520, 0.3);
            // Slow wobble
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 6;
            const depth = ctx.createGain();
            depth.gain.value = 0.25;
            const tremolo = ctx.createGain();
            tremolo.gain.value = 0.85;
            lfo.connect(depth).connect(tremolo.gain);
            lfo.start();
            [lfo, depth, tremolo].forEach(keep);
            chain([mid, tremolo, o]);
        },
    },
    radio: {
        makeup: 1.4,
        fx: (ctx, i, o, keep) => {
            const nodes = [filter(ctx, 'highpass', 450, 0.9), filter(ctx, 'lowpass', 2800, 0.9), filter(ctx, 'peaking', 1600, 1, 5), saturator(ctx, 1.8)];
            nodes.forEach(keep);
            chain([i, ...nodes, o]);
        },
    },
    megaphone: {
        makeup: 1.2,
        fx: (ctx, i, o, keep) => {
            const nodes = [filter(ctx, 'highpass', 700, 1), filter(ctx, 'lowpass', 3300, 1), filter(ctx, 'peaking', 2000, 1.4, 7), saturator(ctx, 4)];
            nodes.forEach(keep);
            chain([i, ...nodes, o]);
        },
    },
    echo: {
        fx: (ctx, i, o, keep) => {
            const delay = ctx.createDelay(1);
            delay.delayTime.value = 0.33;
            const feedback = ctx.createGain();
            feedback.gain.value = 0.38;
            const tone = filter(ctx, 'lowpass', 3000);
            const wet = ctx.createGain();
            wet.gain.value = 0.5;
            [delay, feedback, tone, wet].forEach(keep);
            i.connect(o);
            i.connect(delay);
            delay.connect(tone).connect(feedback).connect(delay);
            delay.connect(wet).connect(o);
        },
    },
    hall: {
        fx: (ctx, i, o, keep) => {
            const convolver = ctx.createConvolver();
            convolver.buffer = impulseResponse(ctx, 2.4, 3);
            const wet = ctx.createGain();
            wet.gain.value = 0.32;
            const dry = ctx.createGain();
            dry.gain.value = 0.9;
            [convolver, wet, dry].forEach(keep);
            i.connect(dry).connect(o);
            i.connect(convolver).connect(wet).connect(o);
        },
    },
};

export class VoiceChanger {
    private context: AudioContext;
    private source: MediaStreamAudioSourceNode | null = null;
    private destination: MediaStreamAudioDestinationNode;
    private output: GainNode;
    private worklets: Promise<boolean>;
    private routeNodes: AudioNode[] = [];
    private routeId = 0;

    constructor() {
        this.context = new window.AudioContext({ latencyHint: 'interactive' });
        this.destination = this.context.createMediaStreamDestination();

        // Shared output stage: gentle levelling, then a brick-wall limiter and a soft clipper so
        // no preset can clip the outgoing track
        this.output = this.context.createGain();
        const leveller = this.context.createDynamicsCompressor();
        leveller.threshold.value = -20;
        leveller.knee.value = 8;
        leveller.ratio.value = 3;
        leveller.attack.value = 0.005;
        leveller.release.value = 0.15;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.08;
        const clipper = this.context.createWaveShaper();
        const curve = new Float32Array(4096);
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            const a = Math.abs(x);
            curve[i] = Math.sign(x) * (a < 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
        }
        clipper.curve = curve;
        chain([this.output, leveller, limiter, clipper, this.destination]);

        this.worklets = this.loadWorklets();
    }

    private async loadWorklets(): Promise<boolean> {
        if (!this.context.audioWorklet) return false;
        const url = URL.createObjectURL(new Blob([VOICE_GATE_PROCESSOR, PITCH_SHIFT_PROCESSOR], { type: 'application/javascript' }));
        try {
            await this.context.audioWorklet.addModule(url);
            return true;
        } catch (err) {
            console.warn('[VoiceChanger] AudioWorklet unavailable, pitch presets fall back to EQ only.', err);
            return false;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    private teardown() {
        for (const node of this.routeNodes) {
            try {
                if (node instanceof OscillatorNode) node.stop();
            } catch { /* already stopped */ }
            node.disconnect();
        }
        this.routeNodes = [];
        this.source?.disconnect();
    }

    public processStream(stream: MediaStream, filterType: VoiceFilter): MediaStream {
        if (this.context.state === 'suspended') {
            this.context.resume().catch(() => { });
        }
        // Only process if there is an audio track
        if (stream.getAudioTracks().length === 0) return stream;

        this.teardown();
        this.routeId += 1;
        const routeId = this.routeId;
        const ctx = this.context;
        const keep = (n: AudioNode) => { this.routeNodes.push(n); };
        this.source = ctx.createMediaStreamSource(stream);

        if (filterType === 'none') {
            this.source.connect(this.output);
        } else {
            const preset = PRESETS[filterType];
            const rumble = filter(ctx, 'highpass', 75);
            // Worklet slot (gate + pitch): a straight wire until the worklets have loaded
            const slotIn = ctx.createGain();
            const slotOut = ctx.createGain();
            const makeup = ctx.createGain();
            makeup.gain.value = preset.makeup ?? 1;
            [rumble, slotIn, slotOut, makeup].forEach(keep);
            chain([this.source, rumble, slotIn]);
            slotIn.connect(slotOut);
            if (preset.fx) preset.fx(ctx, slotOut, makeup, keep);
            else slotOut.connect(makeup);
            makeup.connect(this.output);

            this.worklets.then((ready) => {
                if (!ready || routeId !== this.routeId) return;
                try {
                    const gate = new AudioWorkletNode(ctx, 'voice-gate-processor', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
                    gate.parameters.get('threshold')?.setValueAtTime(preset.gate ?? -52, ctx.currentTime);
                    keep(gate);
                    let tail: AudioNode = gate;
                    if (preset.pitch && preset.pitch !== 1) {
                        const pitch = new AudioWorkletNode(ctx, 'pitch-shift-processor', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
                        pitch.parameters.get('pitch')?.setValueAtTime(preset.pitch, ctx.currentTime);
                        pitch.parameters.get('formant')?.setValueAtTime(preset.formant ?? 1, ctx.currentTime);
                        pitch.parameters.get('preserve')?.setValueAtTime(preset.preserve === false ? 0 : 1, ctx.currentTime);
                        keep(pitch);
                        gate.connect(pitch);
                        tail = pitch;
                    }
                    slotIn.disconnect();
                    slotIn.connect(gate);
                    tail.connect(slotOut);
                } catch (err) {
                    console.warn('[VoiceChanger] Could not insert gate/pitch shifter:', err);
                }
            });
        }

        // Return the modified audio stream combined with the original video tracks
        const processedStream = new MediaStream();
        this.destination.stream.getAudioTracks().forEach(track => processedStream.addTrack(track));
        stream.getVideoTracks().forEach(track => processedStream.addTrack(track));
        return processedStream;
    }

    public stop() {
        this.teardown();
        this.context.close().catch(() => { });
    }
}
