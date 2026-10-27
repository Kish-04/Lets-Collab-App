// Virtual background: MediaPipe selfie segmentation (served locally from /mediapipe, CDN as a
// fallback) with a WebGL2 refinement pipeline:
//   1. temporal smoothing of the mask (fast on motion, steady on flicker)
//   2. joint-bilateral upsampling guided by the camera colours, so edges snap to the real
//      outline (hair, shoulders, fingers) instead of the blocky 256px model output
//   3. edge feathering with a slight dilation to keep hair strands
//   4. person-aware background blur (the person never bleeds into the blur) or a cover-fitted image
//   5. light wrap: a touch of the new background's light on the person's edges
// Falls back to a 2D-canvas compositor when WebGL2 is unavailable.

import { requestFrame } from './frameLoop';

export const BACKGROUND_OPTIONS = [
    { id: 'none', label: 'Normal Background' },
    { id: 'blur-light', label: 'Blur (light)' },
    { id: 'blur', label: 'Blur (medium)' },
    { id: 'blur-strong', label: 'Blur (strong)' },
    { id: 'office', label: 'Office Room' },
    { id: 'bookshelf', label: 'Library' },
    { id: 'studio', label: 'Studio Backdrop' },
    { id: 'mountains', label: 'Mountain Sunset' },
    { id: 'beach', label: 'Tropical Beach' },
    { id: 'space', label: 'Outer Space' },
    { id: 'matrix', label: 'Matrix' },
    { id: 'custom', label: 'Custom...' },
] as const;

export type BackgroundStyle = (typeof BACKGROUND_OPTIONS)[number]['id'];

type BlurStyle = 'blur' | 'blur-light' | 'blur-strong';

const BLUR_STEPS: Record<BlurStyle, { step: number; passes: number; css: number }> = {
    'blur-light': { step: 0.9, passes: 1, css: 6 },
    'blur': { step: 1.6, passes: 1, css: 12 },
    'blur-strong': { step: 2.2, passes: 2, css: 22 },
};

const isBlur = (style: BackgroundStyle): style is BlurStyle => style in BLUR_STEPS;

const backgroundSources: Partial<Record<BackgroundStyle, string>> = {
    office: '/backgrounds/office.svg',
    bookshelf: '/backgrounds/bookshelf.svg',
    studio: '/backgrounds/studio.svg',
    mountains: '/backgrounds/mountains.svg',
    beach: '/backgrounds/beach.svg',
    space: '/backgrounds/space.svg',
    matrix: '/backgrounds/matrix.svg',
};

const LOCAL_BASE = '/mediapipe/selfie_segmentation/';
const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/';

function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existing?.dataset.loaded === 'true') return resolve();
        const script = existing ?? document.createElement('script');
        script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
        script.addEventListener('error', () => { script.remove(); reject(new Error(`Failed to load script: ${src}`)); }, { once: true });
        if (!existing) {
            script.src = src;
            script.async = true;
            document.head.appendChild(script);
        }
    });
}

interface SegmentationResults { image: CanvasImageSource; segmentationMask: CanvasImageSource & { width: number; height: number } }
interface SelfieSegmentationInstance {
    setOptions(options: { modelSelection?: number; selfieMode?: boolean }): void;
    onResults(listener: (results: SegmentationResults) => void): void;
    send(inputs: { image: HTMLCanvasElement | HTMLVideoElement }): Promise<void>;
    close(): Promise<void>;
}
type SelfieSegmentationCtor = new (config: { locateFile: (file: string) => string }) => SelfieSegmentationInstance;

const getSelfieSegmentation = (): SelfieSegmentationCtor | null =>
    typeof window !== 'undefined' ? ((window as unknown as { SelfieSegmentation?: SelfieSegmentationCtor }).SelfieSegmentation ?? null) : null;

// ── WebGL2 pipeline ───────────────────────────────────────────────────────────

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Temporal smoothing: blend toward the new mask quickly where it changed a lot (motion), slowly where
// it only flickers. A small tent filter first removes the model's block artefacts.
const TEMPORAL = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uRaw; uniform sampler2D uPrev; uniform vec2 uTexel; uniform int uChannel; uniform float uReset;
float raw(vec2 uv) { vec4 t = texture(uRaw, uv); return uChannel == 0 ? t.a : t.r; }
void main() {
  float cur = raw(vUv) * 0.4
    + (raw(vUv + vec2(uTexel.x, 0.0)) + raw(vUv - vec2(uTexel.x, 0.0)) + raw(vUv + vec2(0.0, uTexel.y)) + raw(vUv - vec2(0.0, uTexel.y))) * 0.15;
  float prev = texture(uPrev, vUv).r;
  float k = clamp(0.4 + abs(cur - prev) * 1.6, 0.4, 1.0);
  float m = mix(prev, cur, max(k, uReset));
  o = vec4(m, m, m, 1.0);
}`;

// Joint bilateral upsampling: the mask is re-sampled with weights that drop where the camera colour
// differs from the centre pixel, so the edge follows the real silhouette.
const REFINE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uMask; uniform sampler2D uVideo; uniform vec2 uStep; uniform float uColorSigma;
uniform float uLow; uniform float uHigh;
void main() {
  vec3 c0 = texture(uVideo, vUv).rgb;
  float wsum = 0.0; float msum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uStep;
      vec3 d = texture(uVideo, uv).rgb - c0;
      float w = exp(-float(x * x + y * y) / 4.5) * exp(-dot(d, d) * uColorSigma);
      wsum += w; msum += texture(uMask, uv).r * w;
    }
  }
  float m = smoothstep(uLow, uHigh, msum / max(wsum, 1e-4));
  o = vec4(m, m, m, 1.0);
}`;

// Background-only weights for the blur: rgb premultiplied by (1 - person)
const DOWNSAMPLE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uVideo; uniform sampler2D uMask; uniform vec2 uTexel;
void main() {
  vec3 c = (texture(uVideo, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture(uVideo, vUv + uTexel * vec2(0.5, -0.5)).rgb
          + texture(uVideo, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture(uVideo, vUv + uTexel * vec2(0.5, 0.5)).rgb) * 0.25;
  float w = max(1.0 - texture(uMask, vUv).r, 0.02);
  o = vec4(c * w, w);
}`;

const BLUR = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uDir;
void main() {
  vec4 sum = vec4(0.0); float total = 0.0;
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / 18.0);
    sum += texture(uSrc, vUv + uDir * float(i)) * w; total += w;
  }
  o = sum / total;
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uVideo; uniform sampler2D uMask; uniform sampler2D uBlur; uniform sampler2D uImage;
uniform int uMode; uniform vec2 uTexel; uniform float uWrap; uniform float uHasMask;
void main() {
  vec3 fg = texture(uVideo, vUv).rgb;
  if (uHasMask < 0.5 || uMode == 0) { o = vec4(fg, 1.0); return; }
  float m = texture(uMask, vUv).r;
  float soft = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    soft += texture(uMask, vUv + vec2(cos(a), sin(a)) * uTexel * 9.0).r;
  }
  soft /= 8.0;
  vec3 bg; vec3 bgLight;
  if (uMode == 1) {
    vec4 b = texture(uBlur, vUv);
    bg = b.rgb / max(b.a, 1e-3);
    bgLight = bg;
  } else {
    bg = texture(uImage, vUv).rgb;
    bgLight = textureLod(uImage, vUv, 5.0).rgb;
  }
  float wrap = clamp(m * (1.0 - soft) * uWrap, 0.0, 0.45);
  vec3 lit = mix(fg, bgLight, wrap);
  o = vec4(mix(bg, lit, m), 1.0);
}`;

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }

class GLPipeline {
    private gl: WebGL2RenderingContext;
    private programs: Record<string, { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }> = {};
    private quad: WebGLVertexArrayObject;
    private buffer: WebGLBuffer;
    private videoTex: WebGLTexture;
    private rawMaskTex: WebGLTexture;
    private imageTex: WebGLTexture;
    private state: Target[] = [];
    private refined: Target | null = null;
    private blurA: Target | null = null;
    private blurB: Target | null = null;
    private stateIndex = 0;
    private hasMask = false;
    private resetMask = true;
    private hasImage = false;
    public channel = 0;

    constructor(private canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
        this.gl = gl;
        for (const [name, src] of Object.entries({ temporal: TEMPORAL, refine: REFINE, down: DOWNSAMPLE, blur: BLUR, composite: COMPOSITE })) {
            this.programs[name] = { program: this.compile(src), uniforms: new Map() };
        }
        this.buffer = gl.createBuffer()!;
        this.quad = gl.createVertexArray()!;
        gl.bindVertexArray(this.quad);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.videoTex = this.texture();
        this.rawMaskTex = this.texture();
        this.imageTex = this.texture();
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    }

    private compile(fragment: string) {
        const gl = this.gl;
        const shader = (type: number, src: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
            return s;
        };
        const program = gl.createProgram()!;
        const vs = shader(gl.VERTEX_SHADER, VERTEX);
        const fs = shader(gl.FRAGMENT_SHADER, fragment);
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.bindAttribLocation(program, 0, 'aPos');
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
        return program;
    }

    private texture() {
        const gl = this.gl;
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        return tex;
    }

    private target(w: number, h: number): Target {
        const gl = this.gl;
        const tex = this.texture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const fbo = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo, w, h };
    }

    private freeTarget(t: Target | null) {
        if (!t) return;
        this.gl.deleteTexture(t.tex);
        this.gl.deleteFramebuffer(t.fbo);
    }

    // (Re)allocate render targets for a frame size
    resize(w: number, h: number) {
        if (this.refined && this.canvas.width === w && this.canvas.height === h) return;
        this.canvas.width = w;
        this.canvas.height = h;
        [...this.state, this.refined, this.blurA, this.blurB].forEach(t => this.freeTarget(t));
        const sw = 320, sh = Math.max(1, Math.round((320 * h) / w));
        this.state = [this.target(sw, sh), this.target(sw, sh)];
        const rw = Math.min(w, 640), rh = Math.max(1, Math.round((rw * h) / w));
        this.refined = this.target(rw, rh);
        const bw = Math.max(1, Math.round(w / 4)), bh = Math.max(1, Math.round(h / 4));
        this.blurA = this.target(bw, bh);
        this.blurB = this.target(bw, bh);
        this.resetMask = true;
    }

    private use(name: string) {
        const p = this.programs[name];
        this.gl.useProgram(p.program);
        return (uniform: string) => {
            if (!p.uniforms.has(uniform)) p.uniforms.set(uniform, this.gl.getUniformLocation(p.program, uniform));
            return p.uniforms.get(uniform) ?? null;
        };
    }

    private bind(unit: number, tex: WebGLTexture) {
        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
    }

    private draw(target: Target | null) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
        gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
        gl.bindVertexArray(this.quad);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    uploadFrame(frame: TexImageSource) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    }

    uploadMask(mask: TexImageSource) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.rawMaskTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
        this.hasMask = true;
    }

    uploadImage(image: TexImageSource | null) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
        if (!image) {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
            this.hasImage = false;
            return;
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        this.hasImage = true;
    }

    render(style: BackgroundStyle) {
        const gl = this.gl;
        if (!this.refined || !this.blurA || !this.blurB) return;
        const blur = isBlur(style) ? BLUR_STEPS[style] : null;
        const mode = style === 'none' ? 0 : blur ? 1 : this.hasImage ? 2 : 1;

        if (this.hasMask && mode !== 0) {
            // 1. temporal smoothing into the ping-pong state
            const prev = this.state[this.stateIndex];
            const next = this.state[1 - this.stateIndex];
            let u = this.use('temporal');
            this.bind(0, this.rawMaskTex);
            this.bind(1, prev.tex);
            gl.uniform1i(u('uRaw'), 0);
            gl.uniform1i(u('uPrev'), 1);
            gl.uniform2f(u('uTexel'), 1 / next.w, 1 / next.h);
            gl.uniform1i(u('uChannel'), this.channel);
            gl.uniform1f(u('uReset'), this.resetMask ? 1 : 0);
            this.draw(next);
            this.stateIndex = 1 - this.stateIndex;
            this.resetMask = false;

            // 2-3. colour-guided refinement + feathering
            u = this.use('refine');
            this.bind(0, next.tex);
            this.bind(1, this.videoTex);
            gl.uniform1i(u('uMask'), 0);
            gl.uniform1i(u('uVideo'), 1);
            gl.uniform2f(u('uStep'), 1.5 / next.w, 1.5 / next.h);
            gl.uniform1f(u('uColorSigma'), 28);
            gl.uniform1f(u('uLow'), 0.3);
            gl.uniform1f(u('uHigh'), 0.66);
            this.draw(this.refined);

            // 4. person-aware blur at quarter resolution
            if (mode === 1) {
                const settings = blur ?? BLUR_STEPS.blur;
                u = this.use('down');
                this.bind(0, this.videoTex);
                this.bind(1, this.refined.tex);
                gl.uniform1i(u('uVideo'), 0);
                gl.uniform1i(u('uMask'), 1);
                gl.uniform2f(u('uTexel'), 1 / this.canvas.width, 1 / this.canvas.height);
                this.draw(this.blurA);
                for (let pass = 0; pass < settings.passes; pass++) {
                    u = this.use('blur');
                    gl.uniform1i(u('uSrc'), 0);
                    this.bind(0, this.blurA.tex);
                    gl.uniform2f(u('uDir'), settings.step / this.blurA.w, 0);
                    this.draw(this.blurB);
                    this.bind(0, this.blurB.tex);
                    gl.uniform2f(u('uDir'), 0, settings.step / this.blurA.h);
                    this.draw(this.blurA);
                }
            }
        }

        // 5. composite with light wrap
        const u = this.use('composite');
        this.bind(0, this.videoTex);
        this.bind(1, this.refined.tex);
        this.bind(2, this.blurA.tex);
        this.bind(3, this.imageTex);
        gl.uniform1i(u('uVideo'), 0);
        gl.uniform1i(u('uMask'), 1);
        gl.uniform1i(u('uBlur'), 2);
        gl.uniform1i(u('uImage'), 3);
        gl.uniform1i(u('uMode'), mode);
        gl.uniform2f(u('uTexel'), 1 / this.canvas.width, 1 / this.canvas.height);
        gl.uniform1f(u('uWrap'), mode === 2 ? 0.55 : 0.25);
        gl.uniform1f(u('uHasMask'), this.hasMask ? 1 : 0);
        this.draw(null);
    }

    resetTemporal() {
        this.resetMask = true;
    }

    dispose() {
        const gl = this.gl;
        [...this.state, this.refined, this.blurA, this.blurB].forEach(t => this.freeTarget(t));
        [this.videoTex, this.rawMaskTex, this.imageTex].forEach(t => gl.deleteTexture(t));
        Object.values(this.programs).forEach(p => gl.deleteProgram(p.program));
        gl.deleteBuffer(this.buffer);
        gl.deleteVertexArray(this.quad);
    }
}

// ── Public class ──────────────────────────────────────────────────────────────

export class VirtualBackground {
    private canvas: HTMLCanvasElement;
    private gl: GLPipeline | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private selfieSegmentation: SelfieSegmentationInstance | null = null;
    private loading: Promise<void> | null = null;
    private isRunning: boolean = false;
    private currentStyle: BackgroundStyle = 'none';
    private backgroundImage: HTMLImageElement | null = null;
    private imageDirty = true;
    private captureCanvas: HTMLCanvasElement;
    private captureCtx: CanvasRenderingContext2D | null;
    private maskCanvas: HTMLCanvasElement;
    private maskCtx: CanvasRenderingContext2D | null;
    private probeCanvas: HTMLCanvasElement;
    private probeCtx: CanvasRenderingContext2D | null;
    private channelDecided = false;
    private probes = 0;
    private instanceId: number = 0;
    private isProcessing: boolean = false;
    private cancelFrame: (() => void) | null = null;
    private lastSentTime = -1;
    private lastSentAt = 0;
    private stream: MediaStream | null = null;
    public onLoadError?: (err: unknown) => void;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 480;
        this.captureCanvas = document.createElement('canvas');
        this.captureCtx = this.captureCanvas.getContext('2d');
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');
        this.probeCanvas = document.createElement('canvas');
        this.probeCanvas.width = 24;
        this.probeCanvas.height = 24;
        this.probeCtx = this.probeCanvas.getContext('2d', { willReadFrequently: true });

        const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false, premultipliedAlpha: false });
        if (gl) {
            try {
                this.gl = new GLPipeline(this.canvas, gl);
            } catch (err) {
                console.warn('[VirtualBackground] WebGL2 pipeline unavailable, using 2D canvas.', err);
                this.gl = null;
            }
        }
        if (!this.gl) {
            // A canvas that already has a webgl2 context cannot give a 2d one; use a fresh canvas
            if (gl) this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d');
        }
    }

    private initSelfieSegmentation() {
        if (!this.loading) {
            this.loading = (async () => {
                let base = LOCAL_BASE;
                try {
                    await loadScript(`${LOCAL_BASE}selfie_segmentation.js`);
                } catch {
                    base = CDN_BASE;
                    await loadScript(`${CDN_BASE}selfie_segmentation.js`);
                }
                const SelfieSegmentationClass = getSelfieSegmentation();
                if (!SelfieSegmentationClass) throw new Error('Segmentation model failed to load');
                const segmentation = new SelfieSegmentationClass({ locateFile: (file: string) => `${base}${file}` });
                // 0 = general model (256x256 input): the most accurate of the two for a webcam
                segmentation.setOptions({ modelSelection: 0, selfieMode: false });
                segmentation.onResults(this.onResults.bind(this));
                this.selfieSegmentation = segmentation;
            })().catch((err) => {
                console.error('[VirtualBackground] Failed to load segmentation model:', err);
                this.loading = null;
                this.onLoadError?.(err);
            });
        }
        return this.loading;
    }

    public setBackgroundStyle(style: BackgroundStyle, customImageUrl?: string) {
        this.currentStyle = style;
        const src = style === 'custom' ? customImageUrl : backgroundSources[style];
        if (!src) {
            this.backgroundImage = null;
            this.imageDirty = true;
            return;
        }
        if (this.backgroundImage?.dataset.src === src) return;
        const image = new Image();
        image.dataset.src = src;
        image.onload = () => { if (this.backgroundImage === image) this.imageDirty = true; };
        image.onerror = () => {
            if (this.backgroundImage !== image) return;
            this.backgroundImage = null;
            this.imageDirty = true;
            this.onLoadError?.(new Error('Background image failed to load'));
        };
        image.src = src;
        this.backgroundImage = image;
        this.imageDirty = true;
    }

    // Rasterises the background image cover-fitted to the frame (keeps aspect, crops the excess)
    private coverImage(): HTMLCanvasElement | null {
        const image = this.backgroundImage;
        if (!image || !image.complete || !image.naturalWidth) return null;
        const w = this.captureCanvas.width, h = this.captureCanvas.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
        const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
        ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return canvas;
    }

    // The legacy model returns its confidence either in alpha or in red depending on the build:
    // look at the first frames and pick the channel that actually varies.
    private probeChannel(mask: CanvasImageSource) {
        if (this.channelDecided || !this.probeCtx || !this.gl) return;
        this.probeCtx.clearRect(0, 0, 24, 24);
        this.probeCtx.drawImage(mask, 0, 0, 24, 24);
        const data = this.probeCtx.getImageData(0, 0, 24, 24).data;
        let minA = 255, maxA = 0, maxR = 0, minR = 255;
        for (let i = 0; i < data.length; i += 4) {
            minA = Math.min(minA, data[i + 3]); maxA = Math.max(maxA, data[i + 3]);
            minR = Math.min(minR, data[i]); maxR = Math.max(maxR, data[i]);
        }
        if (maxA - minA > 40) { this.gl.channel = 0; this.channelDecided = true; }
        else if (maxR - minR > 40) { this.gl.channel = 1; this.channelDecided = true; }
        else if (++this.probes > 30) this.channelDecided = true;
    }

    private onResults(results: SegmentationResults) {
        if (!this.isRunning) return;
        try {
            if (this.gl) {
                this.gl.resize(this.captureCanvas.width, this.captureCanvas.height);
                if (this.imageDirty) {
                    this.gl.uploadImage(this.coverImage());
                    this.imageDirty = !(this.backgroundImage?.complete ?? true);
                }
                const mask = results.segmentationMask;
                if (this.maskCtx) {
                    if (this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height) {
                        this.maskCanvas.width = mask.width;
                        this.maskCanvas.height = mask.height;
                    }
                    this.maskCtx.clearRect(0, 0, mask.width, mask.height);
                    this.maskCtx.drawImage(mask, 0, 0);
                    this.probeChannel(this.maskCanvas);
                    this.gl.uploadMask(this.maskCanvas);
                } else {
                    this.gl.uploadMask(mask as TexImageSource);
                }
                // The exact frame the mask was computed from, so edges never lag behind the mask
                this.gl.uploadFrame(this.captureCanvas);
                this.gl.render(this.currentStyle);
            } else {
                this.render2D(results);
            }
        } catch (err) {
            console.warn('[VirtualBackground] Render error', err);
        }
    }

    private render2D(results: SegmentationResults) {
        const ctx = this.ctx;
        if (!ctx) return;
        const w = this.captureCanvas.width, h = this.captureCanvas.height;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        ctx.save();
        ctx.clearRect(0, 0, w, h);
        ctx.filter = 'blur(2px)';
        ctx.drawImage(results.segmentationMask, 0, 0, w, h);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(this.captureCanvas, 0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-over';
        const style = this.currentStyle;
        const cover = isBlur(style) ? null : this.coverImage();
        if (cover) {
            ctx.drawImage(cover, 0, 0, w, h);
        } else {
            ctx.filter = `blur(${BLUR_STEPS[isBlur(style) ? style : 'blur'].css}px)`;
            ctx.drawImage(this.captureCanvas, 0, 0, w, h);
            ctx.filter = 'none';
        }
        ctx.restore();
    }

    private drawPassThrough(video: HTMLVideoElement) {
        const w = video.videoWidth, h = video.videoHeight;
        if (this.captureCanvas.width !== w || this.captureCanvas.height !== h) {
            this.captureCanvas.width = w;
            this.captureCanvas.height = h;
            this.imageDirty = true;
        }
        this.captureCtx?.drawImage(video, 0, 0, w, h);
        if (this.gl) {
            this.gl.resize(w, h);
            this.gl.uploadFrame(this.captureCanvas);
            this.gl.render('none');
        } else if (this.ctx) {
            if (this.canvas.width !== w || this.canvas.height !== h) {
                this.canvas.width = w;
                this.canvas.height = h;
            }
            this.ctx.drawImage(this.captureCanvas, 0, 0, w, h);
        }
    }

    public start(videoElement: HTMLVideoElement): MediaStream {
        this.stop();
        this.isRunning = true;
        this.gl?.resetTemporal();
        const myInstanceId = ++this.instanceId;
        this.initSelfieSegmentation();

        const loop = (now: number) => {
            if (!this.isRunning || myInstanceId !== this.instanceId) return;
            this.cancelFrame = requestFrame(loop);
            if (videoElement.readyState < 2 || videoElement.videoWidth === 0) return;
            if (this.isProcessing || videoElement.currentTime === this.lastSentTime || now - this.lastSentAt < 30) return;
            const segmentation = this.selfieSegmentation;
            if (!segmentation || this.currentStyle === 'none') {
                // Model still loading (or nothing to replace): show the camera as is, once per camera frame
                this.lastSentTime = videoElement.currentTime;
                this.lastSentAt = now;
                this.drawPassThrough(videoElement);
                return;
            }
            const w = videoElement.videoWidth, h = videoElement.videoHeight;
            if (this.captureCanvas.width !== w || this.captureCanvas.height !== h) {
                this.captureCanvas.width = w;
                this.captureCanvas.height = h;
                this.imageDirty = true;
                this.gl?.resetTemporal();
            }
            this.captureCtx?.drawImage(videoElement, 0, 0, w, h);
            this.lastSentTime = videoElement.currentTime;
            this.lastSentAt = now;
            this.isProcessing = true;
            segmentation.send({ image: this.captureCanvas })
                .catch((e) => console.warn('[VirtualBackground] Frame process error', e))
                .finally(() => { this.isProcessing = false; });
        };
        this.cancelFrame = requestFrame(loop);
        if (!this.stream || this.stream.getVideoTracks().every(t => t.readyState === 'ended')) this.stream = this.canvas.captureStream(30);
        return this.stream;
    }

    public stop() {
        this.isRunning = false;
        this.instanceId++;
        this.cancelFrame?.();
        this.cancelFrame = null;
        this.lastSentTime = -1;
    }

    public dispose() {
        this.stop();
        this.selfieSegmentation?.close().catch(() => { });
        this.selfieSegmentation = null;
        this.loading = null;
        this.gl?.dispose();
        this.gl = null;
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
    }
}
