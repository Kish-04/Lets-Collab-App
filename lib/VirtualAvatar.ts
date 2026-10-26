import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import type { Avatar3DStyle } from './Avatar3D';
import { acquireFaceLandmarker, nextFaceTimestamp, releaseFaceLandmarker } from './faceLandmarker';
import { requestFrame } from './frameLoop';

// The built-in avatars are all 3D now (lib/Avatar3D.ts); this class only handles a custom image
// that is pinned over the user's face, following its position, size and roll.
export type AvatarStyle = 'none' | 'custom' | Avatar3DStyle;

interface Placement { x: number; y: number; width: number; height: number; angle: number }

export class VirtualAvatar {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private cancelFrame: (() => void) | null = null;
    private isRunning: boolean = false;
    private avatarImage: HTMLImageElement | null = null;
    private currentStyle: AvatarStyle = 'none';
    private landmarker: FaceLandmarker | null = null;
    private trackerRequested = false;
    private lastVideoTime = -1;
    private lastFaceAt = 0;
    private target: Placement | null = null;
    private placement: Placement | null = null;
    private lastFrameAt = 0;
    public onLoadError?: (err: unknown) => void;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 480;
        this.ctx = this.canvas.getContext('2d');
    }

    private requestTracker() {
        if (this.trackerRequested) return;
        this.trackerRequested = true;
        acquireFaceLandmarker()
            .then((landmarker) => { if (this.trackerRequested) this.landmarker = landmarker; })
            .catch((err) => {
                console.error('[VirtualAvatar] Failed to load face tracking:', err);
                this.onLoadError?.(err);
            });
    }

    public setAvatarStyle(style: AvatarStyle, customImageUrl?: string) {
        this.currentStyle = style;
        if (style !== 'custom' || !customImageUrl) {
            this.avatarImage = null;
            return;
        }
        const image = new Image();
        image.onerror = () => {
            if (this.avatarImage !== image) return;
            this.avatarImage = null;
            this.currentStyle = 'none';
            this.onLoadError?.(new Error('Avatar image failed to load'));
        };
        image.src = customImageUrl;
        this.avatarImage = image;
    }

    private track(video: HTMLVideoElement, now: number) {
        if (!this.landmarker || video.currentTime === this.lastVideoTime) return;
        this.lastVideoTime = video.currentTime;
        const face = this.landmarker.detectForVideo(video, nextFaceTimestamp()).faceLandmarks?.[0];
        if (!face) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        // 234/454: cheek edges, 10: top of forehead, 152: chin
        const left = face[234], right = face[454], top = face[10], chin = face[152];
        const dx = (right.x - left.x) * w, dy = (right.y - left.y) * h;
        const faceWidth = Math.hypot(dx, dy);
        const faceHeight = Math.hypot((chin.x - top.x) * w, (chin.y - top.y) * h);
        this.target = {
            x: ((top.x + chin.x) / 2) * w,
            y: ((top.y + chin.y) / 2) * h,
            width: faceWidth * 1.45,
            height: faceHeight * 1.45,
            angle: Math.atan2(dy, dx),
        };
        this.lastFaceAt = now;
    }

    private smooth(dt: number) {
        const t = this.target;
        if (!t) return;
        const p = this.placement;
        if (!p) { this.placement = { ...t }; return; }
        // Faster when the face moves a lot, steadier when it is still (removes jitter without lag)
        const move = Math.hypot(t.x - p.x, t.y - p.y) / Math.max(1, p.width);
        const k = 1 - Math.exp(-dt * (10 + 60 * move));
        p.x += (t.x - p.x) * k;
        p.y += (t.y - p.y) * k;
        p.width += (t.width - p.width) * k;
        p.height += (t.height - p.height) * k;
        p.angle += (t.angle - p.angle) * k;
    }

    public start(videoElement: HTMLVideoElement): MediaStream {
        this.stop();
        this.isRunning = true;
        if (this.currentStyle === 'custom') this.requestTracker();

        const renderLoop = (now: number) => {
            if (!this.isRunning || !this.ctx) return;
            this.cancelFrame = requestFrame(renderLoop);
            const dt = this.lastFrameAt ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 1 / 30;
            this.lastFrameAt = now;
            const ctx = this.ctx;
            if (videoElement.readyState < 2 || videoElement.videoWidth === 0) return;
            if (this.canvas.width !== videoElement.videoWidth || this.canvas.height !== videoElement.videoHeight) {
                this.canvas.width = videoElement.videoWidth;
                this.canvas.height = videoElement.videoHeight;
            }
            try {
                this.track(videoElement, now);
            } catch (e) {
                console.warn('[VirtualAvatar] Face tracking error:', e);
            }
            this.smooth(dt);
            ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);

            const image = this.avatarImage;
            const p = this.placement;
            if (this.currentStyle !== 'custom' || !image || !image.complete || !image.naturalWidth || !p || now - this.lastFaceAt > 1000) return;
            const ratio = image.naturalWidth / image.naturalHeight;
            let width = p.width;
            let height = p.height;
            if (ratio > width / height) height = width / ratio;
            else width = height * ratio;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.drawImage(image, -width / 2, -height / 2, width, height);
            ctx.restore();
        };
        this.cancelFrame = requestFrame(renderLoop);
        return this.canvas.captureStream(30);
    }

    public stop() {
        this.isRunning = false;
        this.cancelFrame?.();
        this.cancelFrame = null;
        this.lastFrameAt = 0;
    }

    public dispose() {
        this.stop();
        if (this.trackerRequested) releaseFaceLandmarker();
        this.trackerRequested = false;
        this.landmarker = null;
    }
}
