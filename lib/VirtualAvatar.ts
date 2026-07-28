import { loadExternalScript } from './utils';

const getFaceApi = () => {
    if (typeof window !== 'undefined' && (window as any).faceapi) {
        return (window as any).faceapi;
    }
    return null;
};

export type AvatarStyle = 'none' | 'cyberpunk' | 'neon' | 'pixel' | 'hologram' | 'sketch' | 'synthwave' | 'anime';

const avatarSources: Record<Exclude<AvatarStyle, 'none'>, string> = {
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
        
        await loadExternalScript("https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js");
        const faceapi = getFaceApi();
        if (!faceapi) return;
        const modelUrl = 'https://justadudewhohacks.github.io/face-api.js/models';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
            faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl)
        ]);
        this.modelsLoaded = true;
    }

    public setAvatarStyle(style: AvatarStyle) {
        this.currentStyle = style;
        if (style === 'none') {
            this.avatarImage = null;
            return;
        }

        this.avatarImage = new Image();
        this.avatarImage.src = avatarSources[style];
        
        // Fall back cleanly if a packaged visual asset is missing.
        this.avatarImage.onerror = () => {
            console.warn(`Avatar image not found: ${this.avatarImage?.src}.`);
            this.currentStyle = 'none';
        };
    }

    private mlLoopRunning: boolean = false;
    private lastDetection: any = null;

    public start(videoElement: HTMLVideoElement): MediaStream {
        this.stop(); // Stop any existing loop
        this.isRunning = true;
        this.mlLoopRunning = true;
        
        // Wait for video to be ready
        if (videoElement.readyState >= 2) {
            this.canvas.width = videoElement.videoWidth || 640;
            this.canvas.height = videoElement.videoHeight || 480;
        }

        // ML Loop (Runs as fast as CPU allows without blocking render)
        const mlLoop = async () => {
            if (!this.mlLoopRunning) return;
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
                    const width = box.width * 1.4;
                    const height = box.height * 1.4;
                    const x = box.x - (width - box.width) / 2;
                    const y = box.y - (height - box.height) / 2;

                    this.ctx.drawImage(this.avatarImage, x, y, width, height);
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
        this.mlLoopRunning = false;
        if (this.loopId) {
            cancelAnimationFrame(this.loopId);
        }
    }
}
