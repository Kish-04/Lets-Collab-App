import { loadExternalScript } from './utils';

const getFaceApi = () => {
    if (typeof window !== 'undefined' && (window as any).faceapi) {
        return (window as any).faceapi;
    }
    return null;
};

export type AvatarStyle = 'none' | 'cyberpunk' | 'neon' | 'pixel' | 'hologram' | 'sketch' | 'synthwave' | 'anime' | 'custom';

const avatarSources: Record<Exclude<AvatarStyle, 'none' | 'custom'>, string> = {
    cyberpunk: '/avatars/cyberpunk-visor.svg',
    neon: '/avatars/neon-mask.svg',
    pixel: '/avatars/pixel-face.svg',
    hologram: '/avatars/hologram.svg',
    sketch: '/avatars/sketch-outline.svg',
    synthwave: '/avatars/synthwave.svg',
    anime: '/avatars/anime.svg',
};

export class VirtualAvatar {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private loopId: number = 0;
    private isRunning: boolean = false;
    private avatarImage: HTMLImageElement | null = null;
    private currentStyle: AvatarStyle = 'none';
    private modelsLoaded: boolean = false;
    private instanceId: number = 0;
    private isProcessing: boolean = false;
    public onLoadError?: (err: unknown) => void;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 480;
        this.ctx = this.canvas.getContext('2d');
        
        this.loadModels();
    }

    private async loadModels() {
        if (this.modelsLoaded) return;
        
        try {
            await loadExternalScript("https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js");
            const faceapi = getFaceApi();
            if (!faceapi) throw new Error('face-api failed to attach to window');
            const modelUrl = '/models/face-api';
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
                faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl)
            ]);
            this.modelsLoaded = true;
        } catch (err) {
            console.error('[VirtualAvatar] Failed to load face detection models:', err);
            this.onLoadError?.(err);
        }
    }

    public setAvatarStyle(style: AvatarStyle, customImageUrl?: string) {
        this.currentStyle = style;
        if (style === 'none') {
            this.avatarImage = null;
            return;
        }

        this.avatarImage = new Image();
        this.avatarImage.src = style === 'custom' && customImageUrl ? customImageUrl : avatarSources[style as keyof typeof avatarSources];
        
        this.avatarImage.onerror = () => {
            this.avatarImage = null;
            this.currentStyle = 'none';
            this.onLoadError?.(new Error('Avatar image failed to load'));
        };
    }

    private lastDetection: any = null;

    public start(videoElement: HTMLVideoElement): MediaStream {
        this.stop();
        this.isRunning = true;
        const myInstanceId = ++this.instanceId;
        
        let lastDetectionTime = 0;
        
        const mlLoop = async () => {
            if (!this.isRunning || myInstanceId !== this.instanceId) return;
            if (this.isProcessing) {
                setTimeout(mlLoop, 30);
                return;
            }

            if (this.currentStyle !== 'none' && this.avatarImage && this.avatarImage.complete) {
                const faceapi = getFaceApi();
                if (faceapi && videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
                    const originalError = console.error;
                    console.error = (...args: any[]) => {
                        const msg = String(args[0] || '').toLowerCase();
                        if (msg.includes('index out of bounds') || msg.includes('abort') || msg.includes('wasm')) return;
                        originalError.apply(console, args);
                    };

                    try {
                        this.isProcessing = true;
                        if (this.modelsLoaded && this.canvas.width > 0) {
                            const detection = await faceapi.detectSingleFace(this.canvas, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
                            if (detection) {
                                this.lastDetection = detection;
                                lastDetectionTime = Date.now();
                            } else if (Date.now() - lastDetectionTime > 1000) {
                                this.lastDetection = undefined;
                            }
                        }
                    } catch (e) {
                        console.warn("[VirtualAvatar] Face tracking error:", e);
                    } finally {
                        this.isProcessing = false;
                        console.error = originalError;
                    }
                }
            }
            setTimeout(mlLoop, 60);
        };
        mlLoop();

        const renderLoop = () => {
            if (!this.isRunning || !this.ctx) return;

            try {
                if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
                    if (this.canvas.width !== videoElement.videoWidth) {
                        this.canvas.width = videoElement.videoWidth;
                        this.canvas.height = videoElement.videoHeight;
                    }
                    this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);
                }
            } catch (e) {}

            if (this.currentStyle !== 'none' && this.avatarImage && this.avatarImage.complete && this.lastDetection) {
                const detection = this.lastDetection;
                const landmarks = detection.landmarks;
                const box = detection.detection.box;

                if (this.currentStyle === 'cyberpunk') {
                    const leftEye = landmarks.getLeftEye();
                    const rightEye = landmarks.getRightEye();
                    const eyeCenterX = (leftEye[0].x + rightEye[3].x) / 2;
                    const eyeCenterY = (leftEye[0].y + rightEye[3].y) / 2;
                    const width = (rightEye[3].x - leftEye[0].x) * 2;
                    const height = width * 0.4;
                    this.ctx.drawImage(this.avatarImage, eyeCenterX - width / 2, eyeCenterY - height / 2, width, height);
                } else {
                    const boxWidth = box.width * 1.4;
                    const boxHeight = box.height * 1.4;
                    const nW = this.avatarImage.naturalWidth || 512;
                    const nH = this.avatarImage.naturalHeight || 512;
                    const imgRatio = nW / nH;
                    const boxRatio = boxWidth / boxHeight;

                    let drawWidth = boxWidth;
                    let drawHeight = boxHeight;
                    if (imgRatio > boxRatio) drawHeight = boxWidth / imgRatio;
                    else drawWidth = boxHeight * imgRatio;
                    const x = box.x - (boxWidth - box.width) / 2 + (boxWidth - drawWidth) / 2;
                    const y = box.y - (boxHeight - box.height) / 2 + (boxHeight - drawHeight) / 2;
                    this.ctx.drawImage(this.avatarImage, x, y, drawWidth, drawHeight);
                }
            }
            this.loopId = requestAnimationFrame(renderLoop);
        };
        renderLoop();
        return this.canvas.captureStream(30);
    }

    public stop() {
        this.isRunning = false;
        this.instanceId++;
        if (this.loopId) cancelAnimationFrame(this.loopId);
    }
}
