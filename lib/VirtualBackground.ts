import { loadExternalScript } from './utils';

const getSelfieSegmentation = () => {
    if (typeof window !== 'undefined' && (window as any).SelfieSegmentation) {
        return (window as any).SelfieSegmentation;
    }
    return null;
};

const getCamera = () => {
    if (typeof window !== 'undefined' && (window as any).Camera) {
        return (window as any).Camera;
    }
    return null;
};

export type BackgroundStyle = 'none' | 'blur' | 'office' | 'beach' | 'space' | 'matrix' | 'custom';

const backgroundSources: Record<Exclude<BackgroundStyle, 'none' | 'blur' | 'custom'>, string> = {
    office: '/backgrounds/office.svg',
    beach: '/backgrounds/beach.svg',
    space: '/backgrounds/space.svg',
    matrix: '/backgrounds/matrix.svg',
};

export class VirtualBackground {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private selfieSegmentation: any;
    private camera: any;
    private isRunning: boolean = false;
    private currentStyle: BackgroundStyle = 'none';
    private backgroundImage: HTMLImageElement | null = null;
    private offscreenCanvas: HTMLCanvasElement;
    private offscreenCtx: CanvasRenderingContext2D | null;
    private fallbackFrameId: number = 0;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 480;
        this.ctx = this.canvas.getContext('2d');

        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = 640;
        this.offscreenCanvas.height = 480;
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }

    private async initSelfieSegmentation() {
        if (this.selfieSegmentation) return;

        await loadExternalScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
        await loadExternalScript("https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js");

        const SelfieSegmentationClass = getSelfieSegmentation();
        if (typeof window !== 'undefined' && SelfieSegmentationClass) {
            this.selfieSegmentation = new SelfieSegmentationClass({
                locateFile: (file: string) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
                }
            });

            this.selfieSegmentation.setOptions({
                modelSelection: 1, // 0 for general, 1 for landscape (faster)
            });

            this.selfieSegmentation.onResults(this.onResults.bind(this));
        }
    }

    public setBackgroundStyle(style: BackgroundStyle, customImageUrl?: string) {
        this.currentStyle = style;
        if (style === 'none' || style === 'blur') {
            this.backgroundImage = null;
            return;
        }

        this.backgroundImage = new Image();
        if (style === 'custom' && customImageUrl) {
            this.backgroundImage.src = customImageUrl;
        } else if (style !== 'custom') {
            this.backgroundImage.src = backgroundSources[style as keyof typeof backgroundSources];
        }
    }

    private onResults(results: any) {
        if (!this.ctx || !this.isRunning) return;

        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw the segmentation mask
        this.ctx.drawImage(results.segmentationMask, 0, 0, this.canvas.width, this.canvas.height);

        // Draw the person on top of the mask
        this.ctx.globalCompositeOperation = 'source-in';
        this.ctx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);

        // Draw the background behind the person
        this.ctx.globalCompositeOperation = 'destination-over';

        if (this.currentStyle === 'blur') {
            if (this.offscreenCtx) {
                // Blur original image using offscreen canvas
                this.offscreenCtx.filter = 'blur(10px)';
                this.offscreenCtx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
                this.offscreenCtx.filter = 'none';
                this.ctx.drawImage(this.offscreenCanvas, 0, 0, this.canvas.width, this.canvas.height);
            }
        } else if (this.backgroundImage && this.backgroundImage.complete) {
            this.ctx.drawImage(this.backgroundImage, 0, 0, this.canvas.width, this.canvas.height);
        } else {
            // Fallback to green screen if image isn't loaded
            this.ctx.fillStyle = '#00FF00';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.ctx.restore();
    }

    public start(videoElement: HTMLVideoElement): MediaStream {
        this.stop(); // Stop any existing loop
        this.isRunning = true;
        
        // Lazy load scripts in the background
        this.initSelfieSegmentation();

        if (videoElement.readyState >= 2) {
            this.canvas.width = videoElement.videoWidth || 640;
            this.canvas.height = videoElement.videoHeight || 480;
            this.offscreenCanvas.width = this.canvas.width;
            this.offscreenCanvas.height = this.canvas.height;
        }

        const CameraClass = getCamera();
        if (this.selfieSegmentation && CameraClass) {
            this.camera = new CameraClass(videoElement, {
                onFrame: async () => {
                    if (this.isRunning && this.selfieSegmentation) {
                        await this.selfieSegmentation.send({image: videoElement});
                    }
                },
                width: this.canvas.width,
                height: this.canvas.height
            });
            this.camera.start();
        } else {
            // Fallback while loading or if not supported
            const drawFallbackFrame = () => {
                if (!this.isRunning || !this.ctx) return;
                this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);
                this.fallbackFrameId = requestAnimationFrame(drawFallbackFrame);
            };
            drawFallbackFrame();
            
            // Re-check once scripts load
            if (!this.selfieSegmentation && typeof window !== 'undefined') {
                const checkInterval = setInterval(() => {
                    if (!this.isRunning) {
                        clearInterval(checkInterval);
                        return;
                    }
                    if (this.selfieSegmentation && getCamera()) {
                        clearInterval(checkInterval);
                        if (this.fallbackFrameId) cancelAnimationFrame(this.fallbackFrameId);
                        this.start(videoElement); // restart with properly loaded models
                    }
                }, 500);
            }
        }
        return this.canvas.captureStream(30);
    }

    public stop() {
        this.isRunning = false;
        if (this.fallbackFrameId) {
            cancelAnimationFrame(this.fallbackFrameId);
            this.fallbackFrameId = 0;
        }
        if (this.camera) {
            this.camera.stop();
            this.camera = null;
        }
    }
}
