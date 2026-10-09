import * as THREE from 'three'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'

export type Avatar3DStyle = 'robot3d' | 'alien3d' | 'bear3d'

export const AVATAR_3D_STYLES: Avatar3DStyle[] = ['robot3d', 'alien3d', 'bear3d']

export function isAvatar3DStyle(style: string): style is Avatar3DStyle {
    return (AVATAR_3D_STYLES as string[]).includes(style)
}

interface Rig {
    root: THREE.Group
    head: THREE.Object3D
    leftEye: THREE.Object3D
    rightEye: THREE.Object3D
    mouth: THREE.Object3D
    leftBrow?: THREE.Object3D
    rightBrow?: THREE.Object3D
    background: number
}

interface Expression {
    blinkLeft: number
    blinkRight: number
    jawOpen: number
    smile: number
    browUp: number
}

const NEUTRAL: Expression = { blinkLeft: 0, blinkRight: 0, jawOpen: 0, smile: 0, browUp: 0 }

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, ...extra })

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number] = [0, 0, 0]) {
    const m = new THREE.Mesh(geometry, material)
    m.position.set(...position)
    return m
}

// The avatar faces +z (towards the camera), so its own left side is at +x on screen
function buildRobot(): Rig {
    const root = new THREE.Group()
    const head = new THREE.Group()
    const shell = mat(0x9aa7b8, { metalness: 0.7, roughness: 0.3 })
    const dark = mat(0x1d2433)
    const glow = mat(0x22d3ee, { emissive: 0x22d3ee, emissiveIntensity: 1.4 })

    head.add(mesh(new THREE.BoxGeometry(1.6, 1.4, 1.3), shell))
    head.add(mesh(new THREE.BoxGeometry(1.3, 0.55, 0.1), dark, [0, 0.12, 0.66]))
    const antenna = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45), shell, [0, 0.92, 0])
    head.add(antenna, mesh(new THREE.SphereGeometry(0.09, 16, 16), glow, [0, 1.17, 0]))
    head.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 20), shell, [0.86, 0, 0]).rotateZ(Math.PI / 2))
    head.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 20), shell, [-0.86, 0, 0]).rotateZ(Math.PI / 2))

    const leftEye = mesh(new THREE.BoxGeometry(0.32, 0.22, 0.05), glow, [0.32, 0.12, 0.72])
    const rightEye = mesh(new THREE.BoxGeometry(0.32, 0.22, 0.05), glow, [-0.32, 0.12, 0.72])
    const mouth = mesh(new THREE.BoxGeometry(0.6, 0.12, 0.05), glow, [0, -0.38, 0.67])
    head.add(leftEye, rightEye, mouth)

    root.add(head, mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.4, 20), dark, [0, -0.95, 0]))
    root.add(mesh(new THREE.BoxGeometry(2.2, 0.9, 1.1), shell, [0, -1.55, 0]))
    return { root, head, leftEye, rightEye, mouth, background: 0x0f172a }
}

function buildAlien(): Rig {
    const root = new THREE.Group()
    const head = new THREE.Group()
    const skin = mat(0x7bd88f, { roughness: 0.6 })
    const black = mat(0x050505, { roughness: 0.1, metalness: 0.3 })

    const skull = mesh(new THREE.SphereGeometry(0.85, 32, 32), skin)
    skull.scale.set(1, 1.25, 0.95)
    const chin = mesh(new THREE.SphereGeometry(0.45, 24, 24), skin, [0, -0.75, 0.15])
    chin.scale.set(1, 1.1, 0.9)
    head.add(skull, chin)

    const eyeGeometry = new THREE.SphereGeometry(0.26, 24, 24)
    const leftEye = mesh(eyeGeometry, black, [0.36, 0.05, 0.62])
    const rightEye = mesh(eyeGeometry, black, [-0.36, 0.05, 0.62])
    leftEye.scale.set(1.2, 0.7, 0.5)
    rightEye.scale.set(1.2, 0.7, 0.5)
    leftEye.rotation.z = 0.35
    rightEye.rotation.z = -0.35
    const mouth = mesh(new THREE.SphereGeometry(0.1, 16, 16), mat(0x14532d), [0, -0.72, 0.55])
    mouth.scale.set(1.4, 0.3, 0.4)
    head.add(leftEye, rightEye, mouth)

    root.add(head, mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.5, 20), skin, [0, -1.2, 0]))
    root.add(mesh(new THREE.SphereGeometry(0.9, 24, 24), mat(0x4c1d95), [0, -2.1, 0]))
    return { root, head, leftEye, rightEye, mouth, background: 0x1e1b4b }
}

function buildBear(): Rig {
    const root = new THREE.Group()
    const head = new THREE.Group()
    const fur = mat(0xa16207, { roughness: 0.9 })
    const light = mat(0xfde68a, { roughness: 0.9 })
    const dark = mat(0x1c1917)

    head.add(mesh(new THREE.SphereGeometry(0.9, 32, 32), fur))
    head.add(mesh(new THREE.SphereGeometry(0.3, 20, 20), fur, [0.65, 0.7, 0]), mesh(new THREE.SphereGeometry(0.3, 20, 20), fur, [-0.65, 0.7, 0]))
    head.add(mesh(new THREE.SphereGeometry(0.15, 16, 16), light, [0.65, 0.7, 0.15]), mesh(new THREE.SphereGeometry(0.15, 16, 16), light, [-0.65, 0.7, 0.15]))
    const muzzle = mesh(new THREE.SphereGeometry(0.38, 24, 24), light, [0, -0.25, 0.7])
    muzzle.scale.set(1.1, 0.8, 0.7)
    head.add(muzzle, mesh(new THREE.SphereGeometry(0.11, 16, 16), dark, [0, -0.12, 0.98]))

    const leftEye = mesh(new THREE.SphereGeometry(0.09, 16, 16), dark, [0.3, 0.2, 0.8])
    const rightEye = mesh(new THREE.SphereGeometry(0.09, 16, 16), dark, [-0.3, 0.2, 0.8])
    const mouth = mesh(new THREE.SphereGeometry(0.1, 16, 16), mat(0x7f1d1d), [0, -0.42, 0.9])
    mouth.scale.set(1.3, 0.25, 0.4)
    const leftBrow = mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), dark, [0.3, 0.38, 0.8])
    const rightBrow = mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), dark, [-0.3, 0.38, 0.8])
    head.add(leftEye, rightEye, mouth, leftBrow, rightBrow)

    root.add(head, mesh(new THREE.SphereGeometry(1.0, 24, 24), fur, [0, -1.75, 0]))
    return { root, head, leftEye, rightEye, mouth, leftBrow, rightBrow, background: 0x064e3b }
}

const BUILDERS: Record<Avatar3DStyle, () => Rig> = { robot3d: buildRobot, alien3d: buildAlien, bear3d: buildBear }

/**
 * Renders a three.js character driven by on-device MediaPipe face tracking (head pose from the
 * facial transformation matrix, expressions from blendshapes). Only the rendered canvas is
 * streamed, so the raw camera image never leaves the device.
 */
export class Avatar3D {
    private canvas: HTMLCanvasElement
    private renderer: THREE.WebGLRenderer
    private scene = new THREE.Scene()
    private camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100)
    private rig: Rig | null = null
    private style: Avatar3DStyle = 'robot3d'
    private landmarker: FaceLandmarker | null = null
    private landmarkerLoading: Promise<void> | null = null
    private loopId = 0
    private running = false
    private lastVideoTime = -1
    private lastFaceAt = 0
    private targetRotation = new THREE.Quaternion()
    private expression: Expression = { ...NEUTRAL }
    private targetExpression: Expression = { ...NEUTRAL }
    public onLoadError?: (err: unknown) => void

    constructor() {
        this.canvas = document.createElement('canvas')
        this.canvas.width = 640
        this.canvas.height = 480
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true })
        this.renderer.setSize(640, 480, false)
        this.camera.position.set(0, -0.2, 6.2)
        this.camera.lookAt(0, -0.35, 0)

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.6))
        const key = new THREE.DirectionalLight(0xffffff, 1.8)
        key.position.set(2, 3, 4)
        this.scene.add(key)
        this.setStyle(this.style)
    }

    public setStyle(style: Avatar3DStyle) {
        this.style = style
        if (this.rig) this.scene.remove(this.rig.root)
        this.rig = BUILDERS[style]()
        this.scene.background = new THREE.Color(this.rig.background)
        this.scene.add(this.rig.root)
    }

    private loadLandmarker() {
        if (!this.landmarkerLoading) {
            this.landmarkerLoading = (async () => {
                try {
                    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
                    const fileset = await FilesetResolver.forVisionTasks('/wasm')
                    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
                        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' },
                        outputFaceBlendshapes: true,
                        outputFacialTransformationMatrixes: true,
                        runningMode: 'VIDEO',
                        numFaces: 1,
                    })
                } catch (err) {
                    console.error('[Avatar3D] Failed to load face tracking:', err)
                    this.onLoadError?.(err)
                }
            })()
        }
        return this.landmarkerLoading
    }

    private track(video: HTMLVideoElement) {
        if (!this.landmarker || video.readyState < 2 || video.currentTime === this.lastVideoTime) return
        this.lastVideoTime = video.currentTime

        const result = this.landmarker.detectForVideo(video, performance.now())
        const matrix = result.facialTransformationMatrixes?.[0]
        if (matrix) {
            const rotation = new THREE.Quaternion()
            new THREE.Matrix4().fromArray(matrix.data).decompose(new THREE.Vector3(), rotation, new THREE.Vector3())
            this.targetRotation.copy(rotation)
            this.lastFaceAt = performance.now()
        }

        const shapes = result.faceBlendshapes?.[0]?.categories
        if (shapes) {
            const score = (name: string) => shapes.find(c => c.categoryName === name)?.score ?? 0
            this.targetExpression = {
                blinkLeft: score('eyeBlinkLeft'),
                blinkRight: score('eyeBlinkRight'),
                jawOpen: score('jawOpen'),
                smile: (score('mouthSmileLeft') + score('mouthSmileRight')) / 2,
                browUp: score('browInnerUp'),
            }
        }
    }

    private animate(now: number) {
        const rig = this.rig
        if (!rig) return

        // Without a face for a while, ease back to an idle pose instead of freezing mid-expression
        if (now - this.lastFaceAt > 1000) {
            this.targetRotation.setFromEuler(new THREE.Euler(Math.sin(now / 1400) * 0.05, Math.sin(now / 1900) * 0.12, 0))
            this.targetExpression = { ...NEUTRAL }
        }

        rig.head.quaternion.slerp(this.targetRotation, 0.35)
        const e = this.expression
        const t = this.targetExpression
        for (const key of Object.keys(e) as (keyof Expression)[]) e[key] += (t[key] - e[key]) * 0.4

        rig.leftEye.scale.y = Math.max(0.08, 1 - e.blinkLeft) * (rig.leftEye.userData.baseY ??= rig.leftEye.scale.y)
        rig.rightEye.scale.y = Math.max(0.08, 1 - e.blinkRight) * (rig.rightEye.userData.baseY ??= rig.rightEye.scale.y)
        const mouthBaseY = (rig.mouth.userData.baseY ??= rig.mouth.scale.y)
        const mouthBaseX = (rig.mouth.userData.baseX ??= rig.mouth.scale.x)
        rig.mouth.scale.y = mouthBaseY * (1 + e.jawOpen * 4)
        rig.mouth.scale.x = mouthBaseX * (1 + e.smile * 0.6)
        for (const brow of [rig.leftBrow, rig.rightBrow]) {
            if (!brow) continue
            const baseY = (brow.userData.baseY ??= brow.position.y)
            brow.position.y = baseY + e.browUp * 0.12
        }
        rig.root.position.y = Math.sin(now / 900) * 0.03
    }

    public start(video: HTMLVideoElement): MediaStream {
        this.stop()
        this.running = true
        this.loadLandmarker()

        const loop = () => {
            if (!this.running) return
            const now = performance.now()
            try {
                this.track(video)
            } catch (err) {
                console.warn('[Avatar3D] Tracking error:', err)
            }
            this.animate(now)
            this.renderer.render(this.scene, this.camera)
            this.loopId = requestAnimationFrame(loop)
        }
        loop()
        return this.canvas.captureStream(30)
    }

    public stop() {
        this.running = false
        if (this.loopId) cancelAnimationFrame(this.loopId)
        this.loopId = 0
    }

    public dispose() {
        this.stop()
        this.landmarker?.close()
        this.landmarker = null
        this.renderer.dispose()
    }
}
