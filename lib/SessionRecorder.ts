export class SessionRecorder {
    private mediaRecorder: MediaRecorder | null = null;
    private recordedChunks: BlobPart[] = [];
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private isRecording: boolean = false;
    private animationFrameId: number | null = null;
    private audioCtx: AudioContext | null = null;
    private dest: MediaStreamAudioDestinationNode | null = null;
    private streamsToStop: MediaStream[] = [];

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1920;
        this.canvas.height = 1080;
        this.ctx = this.canvas.getContext('2d');
    }

    public startRecording(screenVideo: HTMLVideoElement | null, localVideo: HTMLVideoElement | null, remoteVideo: HTMLVideoElement | null, onStop: (url: string) => void) {
        if (!screenVideo) return false;
        
        this.isRecording = true;
        this.recordedChunks = [];
        this.audioCtx = new AudioContext();
        this.dest = this.audioCtx.createMediaStreamDestination();

        // Mix Audio
        const mixAudio = (video: HTMLVideoElement) => {
            if (video.srcObject) {
                const stream = video.srcObject as MediaStream;
                if (stream.getAudioTracks().length > 0) {
                    const source = this.audioCtx!.createMediaStreamSource(stream);
                    source.connect(this.dest!);
                }
            }
        };

        if (screenVideo) mixAudio(screenVideo);
        if (localVideo) mixAudio(localVideo);
        if (remoteVideo) mixAudio(remoteVideo);

        // Mix Video
        const drawFrame = () => {
            if (!this.isRecording || !this.ctx) return;
            
            // Draw main screen
            if (screenVideo && screenVideo.readyState >= 2) {
                this.ctx.drawImage(screenVideo, 0, 0, this.canvas.width, this.canvas.height);
            }

            // Draw PIPs
            const pipWidth = 320;
            const pipHeight = 180;
            const padding = 20;

            if (remoteVideo && remoteVideo.readyState >= 2) {
                this.ctx.drawImage(remoteVideo, this.canvas.width - pipWidth - padding, padding, pipWidth, pipHeight);
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(this.canvas.width - pipWidth - padding, padding, pipWidth, pipHeight);
            }

            if (localVideo && localVideo.readyState >= 2) {
                const offset = (remoteVideo && remoteVideo.readyState >= 2) ? pipHeight + padding * 2 : padding;
                this.ctx.drawImage(localVideo, this.canvas.width - pipWidth - padding, offset, pipWidth, pipHeight);
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(this.canvas.width - pipWidth - padding, offset, pipWidth, pipHeight);
            }

            this.animationFrameId = requestAnimationFrame(drawFrame);
        };
        drawFrame();

        const canvasStream = this.canvas.captureStream(30);
        const compositeStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...this.dest.stream.getAudioTracks()
        ]);

        try {
            const recorderOptions = MediaRecorder.isTypeSupported?.('video/webm')
                ? { mimeType: 'video/webm' }
                : undefined;
            this.mediaRecorder = new MediaRecorder(compositeStream, recorderOptions);
        } catch {
            this.isRecording = false;
            if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
            this.audioCtx?.close().catch(() => { });
            compositeStream.getTracks().forEach(t => t.stop());
            return false;
        }
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordedChunks.push(e.data);
        };
        
        this.mediaRecorder.onstop = () => {
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            onStop(url);
            
            // Cleanup
            this.audioCtx?.close();
            compositeStream.getTracks().forEach(t => t.stop());
            this.mediaRecorder = null;
            this.audioCtx = null;
            this.dest = null;
        };
        
        this.mediaRecorder.start();
        return true;
    }

    public stopRecording() {
        this.isRecording = false;
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
    }
}
