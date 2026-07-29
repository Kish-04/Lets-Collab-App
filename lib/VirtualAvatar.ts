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
    public onLoadError?: (err: unknown) => void;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 480;
        this.ctx = this.canvas.getContext('2d');
        
        // Ensure models are loaded
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
        
        // Fall back cleanly if a packaged visual asset is missing.
        this.avatarImage.onerror = () => {
            console.error(`[VirtualAvatar] Failed to load avatar image: ${this.avatarImage?.src}.`);
            this.avatarImage = null;
            this.currentStyle = 'none';
            this.onLoadError?.(new Error('Avatar image failed to load'));
        };
    }

    private lastDetection: any = null;

    public start(videoElement: HTMLVideoElement): MediaStream {
        this.stop(); // Stop any existing loop
        this.isRunning = true;
        const myInstanceId = ++this.instanceId;
        
        // Wait for video to be ready
        if (videoElement.readyState >= 2) {
            this.canvas.width = videoElement.videoWidth || 640;
            this.canvas.height = videoElement.videoHeight || 480;
        }

        // ML Loop (Runs as fast as CPU allows without blocking render)
        const mlLoop = async () => {
            if (!this.isRunning || myInstanceId !== this.instanceId) return; // bail if superseded
            if (this.currentStyle !== 'none' && this.avatarImage && this.avatarImage.complete) {
                try {
                    const faceapi = getFaceApi();
                    if (faceapi) {
                        this.lastDetection = await faceapi.detectSingleFace(videoElement, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
                    }
                } catch (e) {
                    // Ignore ML errors
                }
            }
            setTimeout(mlLoop, 50); // Small delay to prevent 100% CPU lock
        };
        mlLoop();

        // Fast Render Loop (Runs at monitor refresh rate)
        const renderLoop = () => {
            if (!this.isRunning || !this.ctx) return;

            // Handle dynamic video resizing (fixes pipelining issues)
            if (videoElement.videoWidth > 0 && this.canvas.width !== videoElement.videoWidth) {
                this.canvas.width = videoElement.videoWidth;
                this.canvas.height = videoElement.videoHeight;
            }

            // Draw original video frame immediately
            this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);

            // Draw the last known avatar position on top
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

                    this.ctx.drawImage(
                        this.avatarImage, 
                        eyeCenterX - width / 2, 
                        eyeCenterY - height / 2, 
                        width, 
                        height
                    );
                } else {
                    const boxWidth = box.width * 1.4;
                    const boxHeight = box.height * 1.4;
                    
                    // "contain" style fit logic
                    const imgRatio = this.avatarImage.naturalWidth / this.avatarImage.naturalHeight;
                    const boxRatio = boxWidth / boxHeight;
                    
                    let drawWidth = boxWidth;
                    let drawHeight = boxHeight;
                    
                    if (imgRatio > boxRatio) {
                        // Image is wider than box, fit width
                        drawHeight = boxWidth / imgRatio;
                    } else {
                        // Image is taller than box, fit height
                        drawWidth = boxHeight * imgRatio;
                    }

                    const x = box.x - (boxWidth - box.width) / 2 + (boxWidth - drawWidth) / 2;
                    const y = box.y - (boxHeight - box.height) / 2 + (boxHeight - drawHeight) / 2;

                    this.ctx.drawImage(this.avatarImage, x, y, drawWidth, drawHeight);
                }
            }

            this.loopId = requestAnimationFrame(renderLoop);
        };

        renderLoop();
        
        // Return 30 FPS stream from the augmented canvas
        return this.canvas.captureStream(30);
    }

    public stop() {
        this.isRunning = false;
        this.instanceId++; // invalidate any active mlLoop
        if (this.loopId) {
            cancelAnimationFrame(this.loopId);
        }
    }
}
