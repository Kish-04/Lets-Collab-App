const faceapi = typeof window !== 'undefined' ? require('@vladmandic/face-api') : null;

export type AvatarStyle = 'none' | 'sunglasses' | 'anonymous' | 'fox' | 'spiderman' | 'batman' | 'ironman' | 'pikachu';

export class VirtualAvatar {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private loopId: number = 0;
    private isRunning: boolean = false;
    private avatarImage: HTMLImageElement | null = null;
    private currentStyle: AvatarStyle = 'none';

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 480;
        this.ctx = this.canvas.getContext('2d');
        
        // Ensure models are loaded
        this.loadModels();
    }

    private async loadModels() {
        const modelUrl = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
            faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl)
        ]);
    }

    public setAvatarStyle(style: AvatarStyle) {
        this.currentStyle = style;
        if (style === 'none') {
            this.avatarImage = null;
            return;
        }

        this.avatarImage = new Image();
        if (style === 'sunglasses') {
            this.avatarImage.src = '/avatars/sunglasses.png';
        } else if (style === 'anonymous') {
            this.avatarImage.src = '/avatars/anonymous.png';
        } else if (style === 'fox') {
            this.avatarImage.src = '/avatars/fox.png';
        } else if (style === 'spiderman') {
            this.avatarImage.src = '/avatars/spiderman.png';
        } else if (style === 'batman') {
            this.avatarImage.src = '/avatars/batman.png';
        } else if (style === 'ironman') {
            this.avatarImage.src = '/avatars/ironman.png';
        } else if (style === 'pikachu') {
            this.avatarImage.src = '/avatars/pikachu.png';
        }
        
        // Setup fallback for missing images so the app doesn't crash if the user hasn't downloaded them yet
        this.avatarImage.onerror = () => {
            console.warn(`Avatar image not found: ${this.avatarImage?.src}. Please place a transparent PNG in the public/avatars folder.`);
            this.currentStyle = 'none';
        };
    }

    public start(videoElement: HTMLVideoElement): MediaStream {
        this.isRunning = true;
        
        // Wait for video to be ready
        if (videoElement.readyState >= 2) {
            this.canvas.width = videoElement.videoWidth || 640;
            this.canvas.height = videoElement.videoHeight || 480;
        }

        const renderLoop = async () => {
            if (!this.isRunning || !this.ctx) return;

            // Draw original video frame
            this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);

            if (this.currentStyle !== 'none' && this.avatarImage && this.avatarImage.complete) {
                try {
                    // Detect face and landmarks
                    const detection = await faceapi.detectSingleFace(videoElement, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
                    
                    if (detection) {
                        const landmarks = detection.landmarks;
                        const box = detection.detection.box;

                        if (this.currentStyle === 'sunglasses') {
                            // Position over eyes (landmarks 36 to 45)
                            const leftEye = landmarks.getLeftEye();
                            const rightEye = landmarks.getRightEye();
                            
                            const eyeCenterX = (leftEye[0].x + rightEye[3].x) / 2;
                            const eyeCenterY = (leftEye[0].y + rightEye[3].y) / 2;
                            const width = (rightEye[3].x - leftEye[0].x) * 2;
                            const height = width * 0.4; // aspect ratio approximation

                            this.ctx.drawImage(
                                this.avatarImage, 
                                eyeCenterX - width / 2, 
                                eyeCenterY - height / 2, 
                                width, 
                                height
                            );
                        } else {
                            // Full face mask (Anonymous or Fox)
                            const width = box.width * 1.4;
                            const height = box.height * 1.4;
                            const x = box.x - (width - box.width) / 2;
                            const y = box.y - (height - box.height) / 2;

                            this.ctx.drawImage(this.avatarImage, x, y, width, height);
                        }
                    }
                } catch (e) {
                    // Ignore transient ML errors
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
        if (this.loopId) {
            cancelAnimationFrame(this.loopId);
        }
    }
}
