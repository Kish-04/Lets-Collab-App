// Schedules the next video-effect frame. requestAnimationFrame stops while the tab is in the
// background, which would freeze the camera that other participants see, so hidden tabs fall back
// to a ~30fps timer (browsers keep timers running for pages in an active call).
export function requestFrame(callback: (now: number) => void): () => void {
    if (typeof document !== 'undefined' && document.hidden) {
        const id = setTimeout(() => callback(performance.now()), 33)
        return () => clearTimeout(id)
    }
    const id = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(id)
}
