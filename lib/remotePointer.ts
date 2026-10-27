// Controller side of remote control: where a pointer event falls inside the shared picture.
// The video element uses object-fit: contain, so a shared window whose shape differs from the element
// is letterboxed. Normalising over the element's box would shift every click towards the middle;
// normalise over the picture's own box instead.

export interface VideoPoint {
    x: number
    y: number
    /** false when the pointer is on the black bars around the picture */
    inside: boolean
}

export interface ElementBox {
    left: number
    top: number
    width: number
    height: number
}

export function videoPointFromClient(
    clientX: number,
    clientY: number,
    box: ElementBox,
    videoWidth: number,
    videoHeight: number,
): VideoPoint {
    let left = box.left
    let top = box.top
    let width = box.width
    let height = box.height
    if (videoWidth > 0 && videoHeight > 0 && width > 0 && height > 0) {
        const scale = Math.min(width / videoWidth, height / videoHeight)
        const contentWidth = videoWidth * scale
        const contentHeight = videoHeight * scale
        left += (width - contentWidth) / 2
        top += (height - contentHeight) / 2
        width = contentWidth
        height = contentHeight
    }
    if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, inside: false }
    const rawX = (clientX - left) / width
    const rawY = (clientY - top) / height
    const inside = rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1
    return { x: Math.max(0, Math.min(1, rawX)), y: Math.max(0, Math.min(1, rawY)), inside }
}
