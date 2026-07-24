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

export type BackgroundStyle = 'none' | 'blur' | 'office' | 'beach' | 'space';

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

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 480;
        this.ctx = this.canvas.getContext('2d');

        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = 640;
        this.offscreenCanvas.height = 480;
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        
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

    public setBackgroundStyle(style: BackgroundStyle) {
        this.currentStyle = style;
        if (style === 'none' || style === 'blur') {
            this.backgroundImage = null;
            return;
        }

        this.backgroundImage = new Image();
        if (style === 'office') {
            this.backgroundImage.src = 'https://cdn.pixabay.com/photo/2018/03/10/12/00/teamwork-3213924_1280.jpg';
        } else if (style === 'beach') {
            this.backgroundImage.src = 'https://cdn.pixabay.com/photo/2015/04/23/22/00/tree-736885_1280.jpg';
        } else if (style === 'space') {
            this.backgroundImage.src = 'https://cdn.pixabay.com/photo/2011/12/14/12/11/astronaut-11080_1280.jpg';
        }
        
        this.backgroundImage.crossOrigin = 'anonymous';
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
                    if (this.isRunning) {
                        await this.selfieSegmentation.send({image: videoElement});
                    }
                },
                width: this.canvas.width,
                height: this.canvas.height
            });
            this.camera.start();
        }
        
        return this.canvas.captureStream(30);
    }

    public stop() {
        this.isRunning = false;
        if (this.camera) {
            this.camera.stop();
        }
    }
}
