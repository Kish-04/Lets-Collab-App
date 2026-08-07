import { loadExternalScript } from './utils';

const getSelfieSegmentation = () => {
    if (typeof window !== 'undefined' && (window as any).SelfieSegmentation) {
        return (window as any).SelfieSegmentation;
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
    private isRunning: boolean = false;
    private currentStyle: BackgroundStyle = 'none';
    private backgroundImage: HTMLImageElement | null = null;
    private offscreenCanvas: HTMLCanvasElement;
    private offscreenCtx: CanvasRenderingContext2D | null;
    private readyIntervalId: NodeJS.Timeout | null = null;
    private instanceId: number = 0;
    private isProcessing: boolean = false;
    private fallbackFrameId: number = 0;
    public onLoadError?: (err: unknown) => void;

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

        try {
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
                    modelSelection: 0, // 0 for general (most stable), 1 for landscape
                });

                this.selfieSegmentation.onResults(this.onResults.bind(this));
            }
        } catch (err) {
            console.error('[VirtualBackground] Failed to load segmentation model:', err);
            this.onLoadError?.(err);
        }
    }

    public setBackgroundStyle(style: BackgroundStyle, customImageUrl?: string) {
        this.currentStyle = style;
        if (style === 'none' || style === 'blur') {
            this.backgroundImage = null;
            return;
        }

        this.backgroundImage = new Image();
        this.backgroundImage.onerror = () => {
            this.backgroundImage = null;
            this.onLoadError?.(new Error('Background image failed to load'));
        };
        
        if (style === 'custom' && customImageUrl) {
            this.backgroundImage.src = customImageUrl;
        } else if (style !== 'custom') {
            this.backgroundImage.src = backgroundSources[style as keyof typeof backgroundSources];
        }
    }

    private onResults(results: any) {
        if (!this.ctx || !this.isRunning) return;

        try {
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
                    this.offscreenCtx.filter = 'blur(10px)';
                    this.offscreenCtx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
                    this.offscreenCtx.filter = 'none';
                    this.ctx.drawImage(this.offscreenCanvas, 0, 0, this.canvas.width, this.canvas.height);
                }
            } else if (this.backgroundImage && this.backgroundImage.complete) {
                const imgWidth = this.backgroundImage.width || this.canvas.width;
                const imgHeight = this.backgroundImage.height || this.canvas.height;
                const imgRatio = imgWidth / imgHeight;
                const canvasRatio = this.canvas.width / this.canvas.height;
                
                let drawWidth = this.canvas.width;
                let drawHeight = this.canvas.height;
                let offsetX = 0;
                let offsetY = 0;
                
                if (imgRatio > canvasRatio) {
                    drawWidth = this.canvas.height * imgRatio;
                    offsetX = (this.canvas.width - drawWidth) / 2;
                } else {
                    drawHeight = this.canvas.width / imgRatio;
                    offsetY = (this.canvas.height - drawHeight) / 2;
                }
                
                this.ctx.drawImage(this.backgroundImage, offsetX, offsetY, drawWidth, drawHeight);
            } else {
                this.ctx.fillStyle = '#000000';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
        } catch (err) {
            // Suppress render errors
        } finally {
            this.ctx.restore();
        }
    }

    public start(videoElement: HTMLVideoElement): MediaStream {
        this.stop();
        this.isRunning = true;
        const myInstanceId = ++this.instanceId;
        
        this.initSelfieSegmentation().catch(() => {});

        this.readyIntervalId = setInterval(() => {
            if (!this.isRunning || myInstanceId !== this.instanceId) {
                if (this.readyIntervalId) clearInterval(this.readyIntervalId);
                return;
            }
            if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
                if (this.readyIntervalId) clearInterval(this.readyIntervalId);
                
                this.canvas.width = videoElement.videoWidth;
                this.canvas.height = videoElement.videoHeight;
                this.offscreenCanvas.width = this.canvas.width;
                this.offscreenCanvas.height = this.canvas.height;
                
                const captureCanvas = document.createElement('canvas');
                captureCanvas.width = this.canvas.width;
                captureCanvas.height = this.canvas.height;
                const captureCtx = captureCanvas.getContext('2d');
                
                if (this.selfieSegmentation) {
                    const processFrame = async () => {
                        if (!this.isRunning || myInstanceId !== this.instanceId) return;
                        if (this.isProcessing) {
                            this.fallbackFrameId = requestAnimationFrame(processFrame);
                            return;
                        }
                        if (this.selfieSegmentation && videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
                            if (this.canvas.width !== videoElement.videoWidth) {
                                this.canvas.width = videoElement.videoWidth;
                                this.canvas.height = videoElement.videoHeight;
                                this.offscreenCanvas.width = this.canvas.width;
                                this.offscreenCanvas.height = this.canvas.height;
                                captureCanvas.width = this.canvas.width;
                                captureCanvas.height = this.canvas.height;
                            }
                            
                            this.isProcessing = true;
                            try {
                                if (captureCtx) {
                                    captureCtx.drawImage(videoElement, 0, 0, captureCanvas.width, captureCanvas.height);
                                    await this.selfieSegmentation.send({image: captureCanvas});
                                } else {
                                    await this.selfieSegmentation.send({image: videoElement});
                                }
                            } catch (e) {
                                console.warn("[VirtualBackground] Frame process error", e);
                            } finally {
                                this.isProcessing = false;
                            }
                        }
                        this.fallbackFrameId = requestAnimationFrame(processFrame);
                    };
                    processFrame();
                }
            }
        }, 100);

        const drawFallbackFrame = () => {
            if (!this.isRunning || !this.ctx || myInstanceId !== this.instanceId) return;
            if (this.selfieSegmentation) return; // Stop fallback loop once engine is active
            if (videoElement.videoWidth > 0 && this.canvas.width !== videoElement.videoWidth) {
                this.canvas.width = videoElement.videoWidth;
                this.canvas.height = videoElement.videoHeight;
            }
            if (!this.isProcessing) {
                this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);
            }
            this.fallbackFrameId = requestAnimationFrame(drawFallbackFrame);
        };
        drawFallbackFrame();
            
        return this.canvas.captureStream(30);
    }

    public stop() {
        this.isRunning = false;
        this.instanceId++;
        if (this.fallbackFrameId) {
            cancelAnimationFrame(this.fallbackFrameId);
            this.fallbackFrameId = 0;
        }
        if (this.readyIntervalId) {
            clearInterval(this.readyIntervalId);
            this.readyIntervalId = null;
        }
    }
}
