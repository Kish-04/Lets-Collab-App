import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { acquireFaceTracker, type FaceTracker } from './faceLandmarker'
import { requestFrame } from './frameLoop'
import { AdaptiveInterval } from './proctoringPolicy'

// Every avatar is built procedurally from three.js primitives (no downloaded assets) and driven by
// on-device MediaPipe face tracking: head pose from the facial transformation matrix, blink / gaze /
// jaw / smile / frown / pucker / brows from the blendshapes. Only the rendered canvas is streamed,
// so the raw camera image never leaves the device.
export const AVATAR_3D_OPTIONS = [
    { id: 'human-alex', label: 'Alex', group: 'Realistic people' },
    { id: 'human-maya', label: 'Maya', group: 'Realistic people' },
    { id: 'human-kofi', label: 'Kofi', group: 'Realistic people' },
    { id: 'human-hana', label: 'Hana', group: 'Realistic people' },
    { id: 'human-ravi', label: 'Ravi', group: 'Realistic people' },
    { id: 'human-elder', label: 'Grandpa Joe', group: 'Realistic people' },
    { id: 'astronaut', label: 'Astronaut', group: 'Characters' },
    { id: 'toon-kid', label: 'Spike (cartoon)', group: 'Characters' },
    { id: 'toon-hero', label: 'Masked Hero (cartoon)', group: 'Characters' },
    { id: 'robot3d', label: 'Robot', group: 'Characters' },
    { id: 'alien3d', label: 'Alien', group: 'Characters' },
    { id: 'bear3d', label: 'Bear', group: 'Animals' },
    { id: 'cat3d', label: 'Cat', group: 'Animals' },
    { id: 'fox3d', label: 'Fox', group: 'Animals' },
    { id: 'panda3d', label: 'Panda', group: 'Animals' },
    { id: 'penguin3d', label: 'Penguin', group: 'Animals' },
] as const

export type Avatar3DStyle = (typeof AVATAR_3D_OPTIONS)[number]['id']

export const AVATAR_3D_STYLES: Avatar3DStyle[] = AVATAR_3D_OPTIONS.map(o => o.id)

export function isAvatar3DStyle(style: string): style is Avatar3DStyle {
    return (AVATAR_3D_STYLES as string[]).includes(style)
}

// ── Expression model ──────────────────────────────────────────────────────────

interface Expression {
    blinkL: number
    blinkR: number
    squintL: number
    squintR: number
    jaw: number
    smileL: number
    smileR: number
    frown: number
    pucker: number
    browInner: number
    browOuterL: number
    browOuterR: number
    browDownL: number
    browDownR: number
    lookX: number
    lookY: number
}

const NEUTRAL: Expression = {
    blinkL: 0, blinkR: 0, squintL: 0, squintR: 0, jaw: 0, smileL: 0, smileR: 0, frown: 0, pucker: 0,
    browInner: 0, browOuterL: 0, browOuterR: 0, browDownL: 0, browDownR: 0, lookX: 0, lookY: 0,
}

// Per-channel smoothing rates (1/s): eyelids must follow quickly, the rest is steadier
const RATES: Record<keyof Expression, number> = {
    blinkL: 35, blinkR: 35, squintL: 14, squintR: 14, jaw: 22, smileL: 12, smileR: 12, frown: 10, pucker: 12,
    browInner: 12, browOuterL: 12, browOuterR: 12, browDownL: 12, browDownR: 12, lookX: 18, lookY: 18,
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const remap = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo))
const deg = (d: number) => (d * Math.PI) / 180

// ── Geometry helpers ──────────────────────────────────────────────────────────

interface HeadShape { sx: number; sy: number; sz: number; jaw: number }

const std = (color: number, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })

const glossy = (color: number, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, ...extra })

const skinMat = (color: number) => {
    const c = new THREE.Color(color)
    return new THREE.MeshPhysicalMaterial({
        color: c, roughness: 0.58, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xff9a8a),
        emissive: c.clone().multiplyScalar(0.05),
    })
}

const hairMat = (color: number) =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.62, sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), side: THREE.DoubleSide })

function add(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
    position: [number, number, number] = [0, 0, 0], scale?: [number, number, number], rotation?: [number, number, number]) {
    const m = new THREE.Mesh(geometry, material)
    m.position.set(...position)
    if (scale) m.scale.set(...scale)
    if (rotation) m.rotation.set(...rotation)
    parent.add(m)
    return m
}

const taperOf = (s: HeadShape, ny: number) => (ny < 0 ? 1 - s.jaw * Math.pow(-ny, 1.5) : 1)
const depthOf = (ny: number) => (ny < 0 ? 1 - 0.12 * Math.pow(-ny, 1.5) : 1)

// Maps a point of the unit sphere onto the head surface (narrower jaw, flatter lower face)
function headPoint(s: HeadShape, v: THREE.Vector3, inflate = 1) {
    const t = taperOf(s, v.y)
    return v.set(v.x * t * s.sx * inflate, v.y * s.sy * inflate, v.z * depthOf(v.y) * s.sz * inflate)
}

function shapeHead(geometry: THREE.BufferGeometry, s: HeadShape, inflate = 1) {
    geometry.deleteAttribute('uv')
    const merged = mergeVertices(geometry)
    geometry.dispose()
    const p = merged.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
        headPoint(s, v.fromBufferAttribute(p, i), inflate)
        p.setXYZ(i, v.x, v.y, v.z)
    }
    merged.computeVertexNormals()
    return merged
}

// A partial shell of the head (hair, beard, masks): phi runs around Y (z = sin phi, so 0..PI is the
// front), theta from the crown down; tilt rotates the shell about X before it is fitted to the head
function shell(s: HeadShape, inflate: number, phiStart: number, phiLength: number, thetaStart: number, thetaLength: number, tilt = 0) {
    const g = new THREE.SphereGeometry(1, 56, 28, phiStart, phiLength, thetaStart, thetaLength)
    if (tilt) g.rotateX(tilt)
    return shapeHead(g, s, inflate)
}

// Front surface depth of the head at (x, y)
function surfaceZ(s: HeadShape, x: number, y: number) {
    const ny = y / s.sy
    const nx = x / (s.sx * taperOf(s, ny))
    return Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * s.sz * depthOf(ny)
}

function fibonacciSphere(count: number) {
    const points: THREE.Vector3[] = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < count; i++) {
        const y = 1 - (i / (count - 1)) * 2
        const r = Math.sqrt(1 - y * y)
        points.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r))
    }
    return points
}

function gradientTexture(inner: number, outer: number) {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 384
    const ctx = canvas.getContext('2d')
    if (ctx) {
        const g = ctx.createRadialGradient(256, 150, 20, 256, 200, 420)
        g.addColorStop(0, `#${new THREE.Color(inner).getHexString()}`)
        g.addColorStop(1, `#${new THREE.Color(outer).getHexString()}`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 512, 384)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

// ── Eyes ──────────────────────────────────────────────────────────────────────

interface EyeRig {
    root: THREE.Group
    gaze: THREE.Group
    upper: THREE.Object3D | null
    lower: THREE.Object3D | null
    upperOpen: number
    lowerOpen: number
    baseScaleY: number
}

interface EyeSpec {
    r: number
    iris: number
    irisAngle?: number
    pupilAngle?: number
    pupilSlit?: boolean
    sclera?: number
    lid?: THREE.Material | null
    lidOpen?: number
    lash?: number | null
    emissive?: boolean
}

function buildEye(spec: EyeSpec): EyeRig {
    const r = spec.r
    const root = new THREE.Group()
    const gaze = new THREE.Group()
    root.add(gaze)
    if (spec.emissive) {
        // Light-emitting eye (robot/alien screens): blink by squashing
        add(gaze, new THREE.SphereGeometry(r, 32, 24), new THREE.MeshStandardMaterial({ color: spec.iris, emissive: spec.iris, emissiveIntensity: 1.6, roughness: 0.3 }))
        return { root, gaze, upper: null, lower: null, upperOpen: 0, lowerOpen: 0, baseScaleY: 1 }
    }
    add(root, new THREE.SphereGeometry(r, 32, 24), glossy(spec.sclera ?? 0xf4f1ec, { roughness: 0.3 }))
    const irisAngle = spec.irisAngle ?? 0.62
    const iris = add(gaze, new THREE.SphereGeometry(r * 1.004, 32, 8, 0, Math.PI * 2, 0, irisAngle).rotateX(Math.PI / 2), glossy(spec.iris, { roughness: 0.35 }))
    iris.renderOrder = 1
    const pupil = add(gaze, new THREE.SphereGeometry(r * 1.008, 24, 6, 0, Math.PI * 2, 0, spec.pupilAngle ?? irisAngle * 0.45).rotateX(Math.PI / 2), glossy(0x050505))
    if (spec.pupilSlit) pupil.scale.x = 0.32
    // Catch-light so the eye reads as wet and alive
    add(root, new THREE.SphereGeometry(r * 0.13, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), [r * 0.32, r * 0.38, r * 0.9])

    let upper: THREE.Mesh | null = null
    let lower: THREE.Mesh | null = null
    if (spec.lid) {
        upper = add(root, new THREE.SphereGeometry(r * 1.1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), spec.lid)
        lower = add(root, new THREE.SphereGeometry(r * 1.07, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), spec.lid)
        if (spec.lash !== null) {
            const lash = add(upper, new THREE.TorusGeometry(r * 1.1, r * 0.06, 6, 24, Math.PI).rotateX(Math.PI / 2), std(spec.lash ?? 0x1a1210, 0.8))
            lash.renderOrder = 2
        }
    }
    const rig: EyeRig = { root, gaze, upper, lower, upperOpen: -deg(spec.lidOpen ?? 48), lowerOpen: deg(58), baseScaleY: 1 }
    updateEye(rig, 0, 0, 0, 0)
    return rig
}

function updateEye(eye: EyeRig, blink: number, squint: number, lookX: number, lookY: number) {
    eye.gaze.rotation.set(-lookY * 0.3, lookX * 0.42, 0)
    if (eye.upper && eye.lower) {
        const follow = lookY < 0 ? -lookY * 0.25 : -lookY * 0.12
        eye.upper.rotation.x = THREE.MathUtils.lerp(eye.upperOpen + follow + squint * 0.15, deg(64), blink)
        eye.lower.rotation.x = eye.lowerOpen - squint * deg(26)
    } else {
        eye.root.scale.y = eye.baseScaleY * Math.max(0.08, 1 - blink * 0.95) * (1 - squint * 0.25)
    }
}

// ── Brows ─────────────────────────────────────────────────────────────────────

interface BrowRig { pivot: THREE.Group; side: 1 | -1; baseY: number; range: number }

function buildBrow(material: THREE.Material, side: 1 | -1, length: number, thickness: number, arch: number, range = 0.12): BrowRig {
    const pivot = new THREE.Group()
    const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-length / 2, -arch * 0.3, -0.02), new THREE.Vector3(0, arch, 0.02), new THREE.Vector3(length / 2, -arch * 0.3, -0.02))
    const mesh = add(pivot, new THREE.TubeGeometry(curve, 16, thickness, 8), material)
    mesh.scale.y = 0.75
    pivot.rotation.y = side * 0.32
    return { pivot, side, baseY: 0, range }
}

function placeBrow(head: THREE.Object3D, s: HeadShape, brow: BrowRig, x: number, y: number) {
    brow.pivot.position.set(x, y, surfaceZ(s, x, y) + 0.015)
    brow.baseY = y
    head.add(brow.pivot)
}

function updateBrow(b: BrowRig, e: Expression) {
    const left = b.side > 0
    const outer = left ? e.browOuterL : e.browOuterR
    const down = left ? e.browDownL : e.browDownR
    const up = e.browInner * 0.6 + outer * 0.5
    b.pivot.position.y = b.baseY + (up - down * 0.55) * b.range
    // Inner ends sit toward x = 0: raising them tilts each brow the opposite way
    b.pivot.rotation.z = b.side * (-e.browInner * 0.24 + outer * 0.14 + down * 0.28)
}

// ── Mouth ─────────────────────────────────────────────────────────────────────

const MOUTH_SEGMENTS = 20

interface Ribbon { geometry: THREE.BufferGeometry; positions: Float32Array; z: number }

class Mouth {
    public group = new THREE.Group()
    private cavity: Ribbon
    private teeth: Ribbon | null = null
    private tongue: Ribbon | null = null
    private upperLip: Ribbon | null = null
    private lowerLip: Ribbon | null = null

    constructor(private width: number, private curvature: number, private slope: number, opts: {
        lip?: THREE.Material | null; lipThickness?: number; teeth?: boolean; tongue?: boolean; cavity?: number; closedGap?: number
    } = {}) {
        this.closedGap = opts.closedGap ?? 0.012
        this.lipThickness = opts.lipThickness ?? 0.06
        this.cavity = this.ribbon(std(opts.cavity ?? 0x3b0d14, 0.8), 0)
        if (opts.tongue !== false) this.tongue = this.ribbon(std(0xc65a63, 0.5), 0.003)
        if (opts.teeth !== false) this.teeth = this.ribbon(std(0xf4efe4, 0.35), 0.006)
        if (opts.lip) {
            this.upperLip = this.ribbon(opts.lip, 0.01)
            this.lowerLip = this.ribbon(opts.lip, 0.01)
        }
        this.update(NEUTRAL)
    }

    private closedGap: number
    private lipThickness: number

    private ribbon(material: THREE.Material, z: number): Ribbon {
        const count = (MOUTH_SEGMENTS + 1) * 2
        const positions = new Float32Array(count * 3)
        const normals = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) normals[i * 3 + 2] = 1
        const index: number[] = []
        for (let i = 0; i < MOUTH_SEGMENTS; i++) {
            const a = i * 2, b = a + 1, c = a + 2, d = a + 3
            index.push(a, b, c, b, d, c)
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
        geometry.setIndex(index)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.frustumCulled = false
        this.group.add(mesh)
        return { geometry, positions, z }
    }

    private set(r: Ribbon, i: number, x: number, top: number, bottom: number) {
        const z = r.z - this.curvature * x * x
        const p = r.positions
        p[i * 6] = x; p[i * 6 + 1] = top; p[i * 6 + 2] = z + this.slope * top
        p[i * 6 + 3] = x; p[i * 6 + 4] = bottom; p[i * 6 + 5] = z + this.slope * bottom
    }

    update(e: Expression) {
        const w = this.width
        const N = MOUTH_SEGMENTS
        const smile = (e.smileL + e.smileR) / 2
        const halfW = (w / 2) * (1 - 0.32 * e.pucker + 0.12 * smile)
        const open = e.jaw * 0.46 * w + e.pucker * 0.07 * w
        const gap = this.closedGap * w
        const th = this.lipThickness
        for (let i = 0; i <= N; i++) {
            const u = (i / N) * 2 - 1
            const edge = u * u
            const mid = 1 - edge
            const s = e.smileR + (e.smileL - e.smileR) * ((u + 1) / 2)
            const x = u * halfW
            const lift = (s * 0.17 - e.frown * 0.1) * w * edge
            const top = lift + mid * (gap + open * 0.22)
            const bottom = lift - mid * (gap + open * 0.78) - s * 0.05 * w * mid
            this.set(this.cavity, i, x, top, bottom)
            const inner = top - bottom
            if (this.teeth) this.set(this.teeth, i, x * 0.86, top, top - Math.min(0.1 * w, inner * 0.42) * Math.sqrt(mid))
            if (this.tongue) this.set(this.tongue, i, x * 0.72, bottom + inner * 0.3 * mid, bottom)
            if (this.upperLip && this.lowerLip) {
                const bow = th * 0.28 * Math.exp(-((u / 0.14) ** 2))
                const shape = 0.35 + 0.65 * Math.sqrt(mid)
                this.set(this.upperLip, i, x, top + th * shape - bow, top)
                this.set(this.lowerLip, i, x, bottom, bottom - th * 1.25 * shape)
            }
        }
        for (const r of [this.cavity, this.teeth, this.tongue, this.upperLip, this.lowerLip]) {
            if (r) r.geometry.attributes.position.needsUpdate = true
        }
    }
}

function placeMouth(head: THREE.Object3D, s: HeadShape, y: number, width: number, opts: ConstructorParameters<typeof Mouth>[3] = {}) {
    // Match the mouth to the head's local curvature so it sits on the surface instead of floating
    const sxAtY = s.sx * taperOf(s, y / s.sy)
    const z0 = surfaceZ(s, 0, y)
    const curvature = (s.sz * depthOf(y / s.sy)) / (2 * sxAtY * sxAtY)
    const ny = y / s.sy
    const slope = Math.min(1.2, (s.sz * -ny) / (s.sy * Math.max(0.2, Math.sqrt(1 - ny * ny))))
    const mouth = new Mouth(width, curvature, slope, opts)
    mouth.group.position.set(0, y, z0 + 0.004)
    head.add(mouth.group)
    return mouth
}

// ── Rig ───────────────────────────────────────────────────────────────────────

interface Rig {
    root: THREE.Group
    head: THREE.Group
    skull: THREE.Group
    body: THREE.Group
    jaw: THREE.Group | null
    jawRange: number
    eyes: EyeRig[]
    brows: BrowRig[]
    mouth: Mouth | null
    background: [number, number]
    extra?: (e: Expression, now: number) => void
}

function newRig(background: [number, number]): Rig {
    const root = new THREE.Group()
    const head = new THREE.Group()
    const skull = new THREE.Group()
    const body = new THREE.Group()
    // The head pivots at the neck, not at its centre
    head.position.y = -0.95
    skull.position.y = 0.95
    head.add(skull)
    root.add(body, head)
    return { root, head, skull, body, jaw: null, jawRange: 0.1, eyes: [], brows: [], mouth: null, background }
}

function addTorso(rig: Rig, material: THREE.Material, neckMaterial: THREE.Material | null, opts: { width?: number; collar?: THREE.Material; neck?: number } = {}) {
    const w = opts.width ?? 1
    const neck = opts.neck ?? 0.36
    if (neckMaterial) add(rig.body, new THREE.CylinderGeometry(neck * 0.92, neck * 1.12, 0.9, 28), neckMaterial, [0, -1.3, -0.05])
    const profile = [[0, -1.3], [1.2, -1.25], [1.42, -0.85], [1.34, -0.42], [0.95, -0.08], [0.46, 0.08], [0, 0.1]]
        .map(([r, y]) => new THREE.Vector2(r * w, y))
    const torso = add(rig.body, new THREE.LatheGeometry(profile, 40), material, [0, -1.62, -0.1])
    torso.scale.z = 0.55
    if (opts.collar) add(rig.body, new THREE.TorusGeometry(neck + 0.08, 0.07, 10, 32), opts.collar, [0, -1.56, -0.05], [1, 1, 0.8], [Math.PI / 2, 0, 0])
    return torso
}

function addEyes(rig: Rig, s: HeadShape, spec: EyeSpec, x: number, y: number, sink = 0.45) {
    for (const side of [1, -1] as const) {
        const eye = buildEye(spec)
        eye.root.position.set(side * x, y, surfaceZ(s, side * x, y) - spec.r * sink)
        rig.skull.add(eye.root)
        rig.eyes.push(eye)
    }
}

function addBrows(rig: Rig, s: HeadShape, material: THREE.Material, x: number, y: number, length: number, thickness: number, arch = 0.03) {
    for (const side of [1, -1] as const) {
        const brow = buildBrow(material, side, length, thickness, arch)
        placeBrow(rig.skull, s, brow, side * x, y)
        rig.brows.push(brow)
    }
}

function addEars(rig: Rig, s: HeadShape, material: THREE.Material, y = 0, size = 1) {
    for (const side of [1, -1]) {
        add(rig.skull, new THREE.SphereGeometry(1, 20, 16), material, [side * s.sx * 0.97, y, -0.06 * s.sz], [0.1 * size, 0.24 * size, 0.15 * size], [0, side * 0.35, 0])
    }
}

// ── People ────────────────────────────────────────────────────────────────────

type HairStyle = 'short' | 'swept' | 'long' | 'bob' | 'curly' | 'spiky' | 'balding' | 'sidepart' | 'none'
type BeardStyle = 'stubble' | 'full' | 'moustache' | 'goatee'

interface HumanSpec {
    skin: number
    eye: number
    hair: HairStyle
    hairColor: number
    brow?: number
    lips: number
    lipThickness?: number
    beard?: { style: BeardStyle; color: number }[]
    glasses?: { color: number; round: boolean }
    shirt: number
    collar?: number
    earrings?: number
    shape?: Partial<HeadShape>
    nose?: number
    cartoon?: boolean
    blush?: number
    freckles?: boolean
    mask?: number
    helmet?: boolean
    background: [number, number]
}

function addHair(rig: Rig, s: HeadShape, style: HairStyle, material: THREE.Material) {
    const h = rig.skull
    const cap = (tilt: number, length: number, inflate = 1.05) => add(h, shell(s, inflate, 0, Math.PI * 2, 0, length, tilt), material)
    switch (style) {
        case 'short':
            cap(-0.6, Math.PI * 0.55, 1.06)
            break
        case 'sidepart':
            cap(-0.62, Math.PI * 0.55, 1.06)
            add(h, new THREE.SphereGeometry(1, 28, 16), material, [s.sx * 0.25, s.sy * 0.8, s.sz * 0.46], [0.48, 0.15, 0.36], [0.4, 0, -0.3])
            break
        case 'swept':
            cap(-0.62, Math.PI * 0.55, 1.06)
            add(h, new THREE.SphereGeometry(1, 28, 16), material, [s.sx * 0.1, s.sy * 0.8, s.sz * 0.5], [0.5, 0.17, 0.36], [0.45, 0, -0.15])
            break
        case 'long': {
            cap(-0.4, Math.PI * 0.48)
            const back = new THREE.CylinderGeometry(s.sx * 1.04, s.sx * 1.3, 1.9, 40, 1, true, Math.PI / 2 - 0.2, Math.PI + 0.4)
            add(h, back, material, [0, -0.65, -0.12], [1, 1, s.sz / s.sx])
            for (const side of [1, -1]) {
                add(h, new THREE.CapsuleGeometry(0.17, 1.25, 6, 12), material, [side * s.sx * 0.93, -0.55, 0.22], [1, 1, 0.7], [0.12, 0, side * 0.1])
            }
            break
        }
        case 'bob':
            cap(-0.3, Math.PI * 0.5, 1.06)
            add(h, shell(s, 1.09, Math.PI - 0.55, Math.PI + 1.1, Math.PI * 0.22, Math.PI * 0.5), material)
            add(h, shell(s, 1.08, 0.45, Math.PI - 0.9, Math.PI * 0.1, Math.PI * 0.2), material)
            break
        case 'curly': {
            cap(-0.6, Math.PI * 0.53, 1.04)
            const points = fibonacciSphere(220).filter(p => {
                const q = p.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.6)
                return q.y > Math.cos(Math.PI * 0.5)
            })
            const curls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 1), material, points.length)
            const m = new THREE.Matrix4()
            const q = new THREE.Quaternion()
            points.forEach((p, i) => {
                const pos = headPoint(s, p.clone(), 1.08)
                const scale = 0.85 + ((i * 37) % 10) / 25
                m.compose(pos, q.setFromEuler(new THREE.Euler(i, i * 2, i * 3)), new THREE.Vector3(scale, scale, scale))
                curls.setMatrixAt(i, m)
            })
            h.add(curls)
            break
        }
        case 'spiky': {
            cap(-0.6, Math.PI * 0.53, 1.05)
            const up = new THREE.Vector3(0, 1, 0)
            fibonacciSphere(70).forEach((p, i) => {
                const q = p.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.55)
                if (q.y < Math.cos(Math.PI * 0.3)) return
                const pos = headPoint(s, p.clone(), 1.02)
                const spike = add(h, new THREE.ConeGeometry(0.15, 0.5 + (i % 3) * 0.08, 10), material, [pos.x, pos.y, pos.z])
                spike.quaternion.setFromUnitVectors(up, p.clone().add(new THREE.Vector3(0, 0.4, 0.15)).normalize())
            })
            break
        }
        case 'balding':
            add(h, shell(s, 1.035, Math.PI - 0.3, Math.PI + 0.6, Math.PI * 0.33, Math.PI * 0.27), material)
            break
        case 'none':
            break
    }
}

function addBeard(rig: Rig, s: HeadShape, beard: { style: BeardStyle; color: number }, mouthY: number) {
    const h = rig.skull
    switch (beard.style) {
        case 'stubble': {
            // Shadow that fades in from the cheeks down to the jaw (vertex alpha), not a hard band
            const m = std(beard.color, 0.95, 0, { transparent: true, opacity: 0.32, depthWrite: false, vertexColors: true })
            const g = shell(s, 1.008, -0.25, Math.PI + 0.5, Math.PI * 0.6, Math.PI * 0.38)
            const p = g.attributes.position
            let top = -Infinity
            for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i))
            const colors = new Float32Array(p.count * 4)
            for (let i = 0; i < p.count; i++) {
                colors.set([1, 1, 1, THREE.MathUtils.smoothstep(top - p.getY(i), 0, 0.35)], i * 4)
            }
            g.setAttribute('color', new THREE.BufferAttribute(colors, 4))
            add(h, g, m)
            break
        }
        case 'full': {
            const m = hairMat(beard.color)
            const jaw = rig.jaw ?? rig.skull
            add(jaw, shell(s, 1.05, -0.15, Math.PI + 0.3, Math.PI * 0.69, Math.PI * 0.31), m)
            for (const [start] of [[-0.45], [Math.PI - 0.45]]) add(h, shell(s, 1.04, start, 0.9, Math.PI * 0.4, Math.PI * 0.34), m)
            addMoustache(h, s, mouthY, m, 1)
            break
        }
        case 'moustache':
            addMoustache(h, s, mouthY, hairMat(beard.color), 0.9)
            break
        case 'goatee': {
            const m = hairMat(beard.color)
            add(rig.jaw ?? h, shell(s, 1.04, Math.PI / 2 - 0.45, 0.9, Math.PI * 0.72, Math.PI * 0.26), m)
            break
        }
    }
}

function addMoustache(h: THREE.Object3D, s: HeadShape, mouthY: number, material: THREE.Material, width: number) {
    const y = mouthY + 0.1
    const pts = [-0.25, -0.12, 0, 0.12, 0.25].map(x => {
        const xx = x * width
        const drop = Math.abs(xx) > 0.2 ? -0.05 : 0
        return new THREE.Vector3(xx, y + drop - Math.abs(xx) * 0.1, surfaceZ(s, xx, y) + 0.035)
    })
    const tube = add(h, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.045, 10), material)
    tube.scale.y = 0.8
}

function addGlasses(rig: Rig, s: HeadShape, eyeX: number, eyeY: number, eyeR: number, glasses: { color: number; round: boolean }) {
    const frame = std(glasses.color, 0.35, 0.6)
    const lens = new THREE.MeshPhysicalMaterial({ color: 0xdfefff, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.16, depthWrite: false })
    const z = surfaceZ(s, eyeX, eyeY) + eyeR * 0.75
    const radius = eyeR * 1.55
    for (const side of [1, -1]) {
        const ring = glasses.round
            ? new THREE.TorusGeometry(radius, 0.022, 8, 40)
            : new THREE.TorusGeometry(radius, 0.026, 8, 4).rotateZ(Math.PI / 4).scale(1.15, 0.8, 1)
        add(rig.skull, ring, frame, [side * eyeX, eyeY, z])
        add(rig.skull, new THREE.CircleGeometry(radius, 32).scale(glasses.round ? 1 : 1.15, glasses.round ? 1 : 0.8, 1), lens, [side * eyeX, eyeY, z - 0.005])
        const hingeX = Math.max(eyeX + radius, s.sx * 0.88)
        const hingeZ = Math.min(z - 0.04, surfaceZ(s, hingeX, eyeY) + 0.06)
        const armLength = hingeZ + 0.2
        add(rig.skull, new THREE.BoxGeometry(0.03, 0.03, armLength), frame, [side * (hingeX + 0.02), eyeY + 0.02, hingeZ - armLength / 2])
        const hinge = new THREE.LineCurve3(new THREE.Vector3(side * (eyeX + radius * 0.95), eyeY + 0.02, z), new THREE.Vector3(side * (hingeX + 0.02), eyeY + 0.02, hingeZ))
        add(rig.skull, new THREE.TubeGeometry(hinge, 1, 0.018, 6), frame)
    }
    add(rig.skull, new THREE.CylinderGeometry(0.018, 0.018, eyeX * 2 - radius * 2 + 0.02, 8), frame, [0, eyeY + 0.03, z + 0.02], undefined, [0, 0, Math.PI / 2])
}

function buildHuman(spec: HumanSpec): Rig {
    const rig = newRig(spec.background)
    const s: HeadShape = { sx: 0.84, sy: 1.1, sz: 0.94, jaw: 0.3, ...spec.shape }
    const skin = skinMat(spec.skin)
    const h = rig.skull
    const toon = !!spec.cartoon

    add(h, shapeHead(new THREE.SphereGeometry(1, 64, 48), s), skin)
    addEars(rig, s, skin, 0.0, toon ? 1.1 : 1)

    // Jaw group carries the chin beard so it follows the open mouth
    rig.jaw = new THREE.Group()
    rig.jawRange = 0.11
    h.add(rig.jaw)

    // Nose
    const n = spec.nose ?? 1
    if (toon) {
        add(h, new THREE.SphereGeometry(0.1 * n, 20, 16), skin, [0, -0.14, surfaceZ(s, 0, -0.14) + 0.04])
    } else {
        const bridgeZ = surfaceZ(s, 0, -0.04)
        add(h, new THREE.CapsuleGeometry(0.042 * n, 0.26, 6, 12), skin, [0, -0.08, bridgeZ - 0.004], [1, 1, 0.8], [0.42, 0, 0])
        const tipY = -0.24
        add(h, new THREE.SphereGeometry(0.085 * n, 24, 16), skin, [0, tipY, surfaceZ(s, 0, tipY) + 0.1 * n])
        for (const side of [1, -1]) add(h, new THREE.SphereGeometry(0.06 * n, 16, 12), skin, [side * 0.075 * n, tipY - 0.03, surfaceZ(s, side * 0.07, tipY) + 0.05 * n])
    }

    // Eyes and brows
    const eyeR = toon ? 0.19 : 0.125
    const eyeX = toon ? 0.33 : 0.3
    const eyeY = toon ? 0.03 : 0.1
    addEyes(rig, s, { r: eyeR, iris: spec.eye, irisAngle: toon ? 0.75 : 0.6, lid: skin, lidOpen: toon ? 55 : 45, lash: toon ? 0x111111 : 0x20140f }, eyeX, eyeY, toon ? 0.35 : 0.5)
    addBrows(rig, s, hairMat(spec.brow ?? spec.hairColor), eyeX + 0.01, eyeY + eyeR + (toon ? 0.13 : 0.11), toon ? 0.26 : 0.27, toon ? 0.04 : 0.032)

    // Mouth
    const mouthY = toon ? -0.42 : -0.47
    rig.mouth = placeMouth(h, s, mouthY, toon ? 0.42 : 0.38, {
        lip: toon ? null : skinMatLip(spec.lips), lipThickness: spec.lipThickness ?? 0.055, closedGap: toon ? 0.03 : 0.012,
    })

    if (spec.blush) {
        const blush = new THREE.MeshBasicMaterial({ color: spec.blush, transparent: true, opacity: 0.35, depthWrite: false })
        for (const side of [1, -1]) add(h, new THREE.CircleGeometry(0.11, 24), blush, [side * 0.45, -0.18, surfaceZ(s, side * 0.45, -0.18) + 0.006], undefined, [0, side * 0.5, 0])
    }
    if (spec.freckles) {
        const dot = std(0x9a5a33, 0.9)
        for (let i = 0; i < 14; i++) {
            const side = i % 2 ? 1 : -1
            const x = side * (0.25 + ((i * 13) % 7) * 0.035)
            const y = -0.08 - ((i * 7) % 5) * 0.03
            add(h, new THREE.CircleGeometry(0.014, 8), dot, [x, y, surfaceZ(s, x, y) + 0.004], undefined, [0, side * 0.45, 0])
        }
    }
    if (spec.mask) {
        add(h, shell(s, 1.025, 0.2, Math.PI - 0.4, Math.PI * 0.4, Math.PI * 0.14), std(spec.mask, 0.4, 0.1))
    }

    addHair(rig, s, spec.hair, hairMat(spec.hairColor))
    for (const beard of spec.beard ?? []) addBeard(rig, s, beard, mouthY)
    if (spec.glasses) addGlasses(rig, s, eyeX, eyeY, eyeR, spec.glasses)
    if (spec.earrings) {
        const gold = std(spec.earrings, 0.25, 1)
        for (const side of [1, -1]) add(h, new THREE.TorusGeometry(0.06, 0.014, 8, 24), gold, [side * s.sx * 0.99, -0.3, 0.02], undefined, [0, Math.PI / 2, 0])
    }
    if (spec.helmet) {
        const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, clearcoat: 1 })
        add(rig.head, new THREE.SphereGeometry(1.62, 48, 32), glass, [0, 0.95, 0.05])
        add(rig.body, new THREE.TorusGeometry(0.95, 0.15, 16, 48), std(0xe5e7eb, 0.4, 0.3), [0, -1.55, -0.05], [1, 1, 0.8], [Math.PI / 2, 0, 0])
    }

    addTorso(rig, std(spec.shirt, 0.85), skin, { collar: spec.collar !== undefined ? std(spec.collar, 0.8) : undefined })
    return rig
}

function skinMatLip(color: number) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3, side: THREE.DoubleSide })
}

const PEOPLE: Record<string, HumanSpec> = {
    'human-alex': {
        skin: 0xd9a27e, eye: 0x4b6b8a, hair: 'swept', hairColor: 0x4a2f1d, lips: 0xb8705f,
        beard: [{ style: 'stubble', color: 0x3a2618 }], shirt: 0x2f4f7f, collar: 0x223a5e, background: [0x5d7ea8, 0x1b2638],
    },
    'human-maya': {
        skin: 0xf0c4a4, eye: 0x5a3b22, hair: 'long', hairColor: 0x7a2f1b, lips: 0xc0505e, lipThickness: 0.065,
        earrings: 0xe8c15a, shirt: 0x8b3a62, shape: { sx: 0.8, sy: 1.08, jaw: 0.34 }, nose: 0.85, background: [0xe7b7a3, 0x5b2b3f],
    },
    'human-kofi': {
        skin: 0x6b4330, eye: 0x2b1a10, hair: 'curly', hairColor: 0x161110, lips: 0x5a3027, lipThickness: 0.07,
        beard: [{ style: 'full', color: 0x161110 }], glasses: { color: 0x1c1c1c, round: true }, shirt: 0x2f6b4f, collar: 0x245540,
        shape: { sx: 0.86, jaw: 0.26 }, nose: 1.15, background: [0xd9a441, 0x3d2a12],
    },
    'human-hana': {
        skin: 0xf3d2b8, eye: 0x2a1a12, hair: 'bob', hairColor: 0x121014, lips: 0xd0707a, shirt: 0xf2f2f2, collar: 0xd4d4d8,
        shape: { sx: 0.82, sy: 1.06, jaw: 0.36 }, nose: 0.8, blush: 0xff8a9a, background: [0xa7c7e7, 0x2b3f5c],
    },
    'human-ravi': {
        skin: 0xa8714f, eye: 0x2e1d12, hair: 'sidepart', hairColor: 0x0f0c0b, lips: 0x8a4c40,
        beard: [{ style: 'moustache', color: 0x0f0c0b }, { style: 'stubble', color: 0x0f0c0b }], shirt: 0xc9822b, collar: 0xf0e6d2,
        nose: 1.1, background: [0xf0b46a, 0x6b2d1a],
    },
    'human-elder': {
        skin: 0xeab89a, eye: 0x6c8aa0, hair: 'balding', hairColor: 0xd9d9d9, brow: 0xcfcfcf, lips: 0xb07a6c, lipThickness: 0.045,
        beard: [{ style: 'full', color: 0xe5e5e5 }], glasses: { color: 0x8a6d3b, round: false }, shirt: 0x6b5a45, collar: 0x8a7a63,
        shape: { sx: 0.86, jaw: 0.24 }, nose: 1.2, background: [0x9fbf9a, 0x2f4030],
    },
    'astronaut': {
        skin: 0xc68b67, eye: 0x3b2a1a, hair: 'short', hairColor: 0x2a1c12, lips: 0xa0604f, shirt: 0xf1f5f9, collar: 0xcbd5e1,
        helmet: true, background: [0x1e3a8a, 0x020617],
    },
    'toon-kid': {
        skin: 0xffd1ae, eye: 0x2f7a3a, hair: 'spiky', hairColor: 0xf97316, lips: 0xd9776c, cartoon: true, freckles: true, blush: 0xff7a7a,
        shirt: 0x2563eb, collar: 0xfacc15, shape: { sx: 0.95, sy: 1.0, sz: 0.95, jaw: 0.22 }, background: [0xfde68a, 0xf59e0b],
    },
    'toon-hero': {
        skin: 0xf1c27d, eye: 0x1d4ed8, hair: 'swept', hairColor: 0x111827, lips: 0xb45f4d, cartoon: true, mask: 0xdc2626,
        shirt: 0x1d4ed8, collar: 0xdc2626, shape: { sx: 0.92, sy: 1.04, sz: 0.95, jaw: 0.3 }, background: [0x60a5fa, 0x1e1b4b],
    },
}

// ── Animals and characters ────────────────────────────────────────────────────

function buildBear(): Rig {
    const rig = newRig([0x86efac, 0x14532d])
    const s: HeadShape = { sx: 1, sy: 0.95, sz: 0.92, jaw: 0.08 }
    const fur = std(0x8b5a2b, 0.95)
    const light = std(0xe6c49a, 0.9)
    const h = rig.skull
    add(h, shapeHead(new THREE.SphereGeometry(1, 48, 36), s), fur)
    for (const side of [1, -1]) {
        add(h, new THREE.SphereGeometry(0.3, 24, 16), fur, [side * 0.7, 0.72, -0.05], [1, 1, 0.7])
        add(h, new THREE.SphereGeometry(0.17, 20, 12), light, [side * 0.7, 0.72, 0.12], [1, 1, 0.4])
    }
    const muzzleZ = surfaceZ(s, 0, -0.32)
    add(h, new THREE.SphereGeometry(1, 32, 24), light, [0, -0.32, muzzleZ - 0.12], [0.45, 0.33, 0.36])
    add(h, new THREE.SphereGeometry(1, 24, 16), glossy(0x1a1310), [0, -0.16, muzzleZ + 0.2], [0.14, 0.1, 0.1])
    addEyes(rig, s, { r: 0.1, iris: 0x2a1408, irisAngle: 0.95, pupilAngle: 0.5, lid: fur, lidOpen: 55, lash: null }, 0.32, 0.18, 0.4)
    addBrows(rig, s, std(0x5c3a1b, 0.95), 0.34, 0.37, 0.18, 0.035, 0.02)
    rig.mouth = new Mouth(0.26, 0.6, 0.3, { lip: null, closedGap: 0.04, cavity: 0x4a1218 })
    rig.mouth.group.position.set(0, -0.43, muzzleZ + 0.2)
    h.add(rig.mouth.group)
    addTorso(rig, fur, fur, { width: 1.05, neck: 0.62 })
    add(rig.body, new THREE.SphereGeometry(1, 24, 16), light, [0, -1.95, 0.35], [0.7, 0.55, 0.25])
    return rig
}

function buildCat(): Rig {
    const rig = newRig([0xc4b5fd, 0x3b0764])
    const s: HeadShape = { sx: 1, sy: 0.86, sz: 0.88, jaw: 0.25 }
    const fur = std(0xf2a65a, 0.9)
    const white = std(0xfff7ed, 0.9)
    const pink = std(0xf9a8b8, 0.7)
    const stripe = std(0xc2702a, 0.9)
    const h = rig.skull
    add(h, shapeHead(new THREE.SphereGeometry(1, 48, 36), s), fur)
    const ears: THREE.Object3D[] = []
    for (const side of [1, -1]) {
        const ear = new THREE.Group()
        ear.position.set(side * 0.55, 0.62, -0.05)
        ear.rotation.z = -side * 0.35
        add(ear, new THREE.ConeGeometry(0.32, 0.6, 4), fur, [0, 0.25, 0], [1, 1, 0.45], [0, Math.PI / 4, 0])
        add(ear, new THREE.ConeGeometry(0.2, 0.42, 4), pink, [0, 0.22, 0.07], [1, 1, 0.3], [0, Math.PI / 4, 0])
        h.add(ear)
        ears.push(ear)
    }
    for (const x of [-0.14, 0, 0.14]) add(h, new THREE.CapsuleGeometry(0.035, 0.22, 4, 8), stripe, [x, 0.62, surfaceZ(s, x, 0.62) - 0.01], undefined, [0.75, 0, 0])
    const muzzleZ = surfaceZ(s, 0, -0.3)
    for (const side of [1, -1]) add(h, new THREE.SphereGeometry(0.2, 24, 16), white, [side * 0.14, -0.3, muzzleZ - 0.05], [1, 0.8, 0.8])
    add(h, new THREE.ConeGeometry(0.07, 0.07, 3), pink, [0, -0.17, muzzleZ + 0.1], undefined, [Math.PI / 2, 0, Math.PI])
    const whisker = std(0xffffff, 0.4)
    for (const side of [1, -1]) {
        for (let i = 0; i < 3; i++) {
            add(h, new THREE.CylinderGeometry(0.006, 0.006, 0.6, 4), whisker, [side * 0.48, -0.28 + i * 0.05, muzzleZ - 0.02], undefined, [0, 0, Math.PI / 2 + side * (i - 1) * 0.15])
        }
    }
    addEyes(rig, s, { r: 0.15, iris: 0x7cc45a, irisAngle: 1.0, pupilAngle: 0.7, pupilSlit: true, lid: fur, lidOpen: 52, lash: null }, 0.34, 0.08, 0.45)
    addBrows(rig, s, stripe, 0.34, 0.3, 0.16, 0.025, 0.02)
    rig.mouth = new Mouth(0.22, 0.7, 0.3, { lip: null, closedGap: 0.03, cavity: 0x5b1622 })
    rig.mouth.group.position.set(0, -0.44, muzzleZ + 0.08)
    h.add(rig.mouth.group)
    addTorso(rig, fur, fur, { width: 0.95, neck: 0.58 })
    add(rig.body, new THREE.SphereGeometry(1, 24, 16), white, [0, -1.9, 0.32], [0.55, 0.5, 0.2])
    rig.extra = (e) => ears.forEach((ear, i) => { ear.rotation.x = -e.browInner * 0.25 + e.browDownL * 0.2; ear.position.y = 0.62 + (i ? e.browOuterR : e.browOuterL) * 0.04 })
    return rig
}

function buildFox(): Rig {
    const rig = newRig([0xfdba74, 0x7c2d12])
    const s: HeadShape = { sx: 0.95, sy: 0.88, sz: 0.85, jaw: 0.42 }
    const fur = std(0xe8661c, 0.85)
    const white = std(0xfffbf5, 0.9)
    const dark = std(0x1c1917, 0.8)
    const h = rig.skull
    add(h, shapeHead(new THREE.SphereGeometry(1, 48, 36), s), fur)
    for (const side of [1, -1]) {
        const ear = new THREE.Group()
        ear.position.set(side * 0.5, 0.62, -0.1)
        ear.rotation.z = -side * 0.28
        add(ear, new THREE.ConeGeometry(0.3, 0.8, 4), fur, [0, 0.35, 0], [1, 1, 0.4], [0, Math.PI / 4, 0])
        add(ear, new THREE.ConeGeometry(0.13, 0.28, 4), dark, [0, 0.66, 0.01], [1, 1, 0.45], [0, Math.PI / 4, 0])
        add(ear, new THREE.ConeGeometry(0.18, 0.45, 4), white, [0, 0.28, 0.07], [1, 1, 0.3], [0, Math.PI / 4, 0])
        h.add(ear)
        add(h, new THREE.SphereGeometry(1, 24, 16), white, [side * 0.55, -0.35, 0.35], [0.38, 0.3, 0.3], [0, 0, side * 0.5])
    }
    const snoutZ = surfaceZ(s, 0, -0.2)
    add(h, new THREE.ConeGeometry(0.34, 0.75, 32), fur, [0, -0.2, snoutZ + 0.15], [1, 0.8, 1], [Math.PI / 2, 0, 0])
    add(h, new THREE.ConeGeometry(0.3, 0.68, 32, 1, false, -Math.PI / 2, Math.PI), white, [0, -0.24, snoutZ + 0.15], [1, 0.75, 1], [Math.PI / 2, 0, 0])
    add(h, new THREE.SphereGeometry(0.075, 16, 12), glossy(0x0c0a09), [0, -0.19, snoutZ + 0.53])
    addEyes(rig, s, { r: 0.12, iris: 0xd97706, irisAngle: 0.9, pupilAngle: 0.45, lid: fur, lidOpen: 45, lash: 0x1c1917 }, 0.33, 0.12, 0.45)
    addBrows(rig, s, std(0x9a3412, 0.9), 0.33, 0.33, 0.17, 0.025, 0.02)
    rig.mouth = new Mouth(0.2, 0.4, 0, { lip: null, closedGap: 0.04, cavity: 0x4c0d14 })
    rig.mouth.group.position.set(0, -0.36, snoutZ + 0.3)
    h.add(rig.mouth.group)
    addTorso(rig, fur, fur, { width: 0.95, neck: 0.58 })
    add(rig.body, new THREE.SphereGeometry(1, 24, 16), white, [0, -1.85, 0.32], [0.55, 0.55, 0.2])
    return rig
}

function buildPanda(): Rig {
    const rig = newRig([0xbbf7d0, 0x166534])
    const s: HeadShape = { sx: 1.02, sy: 0.92, sz: 0.9, jaw: 0.1 }
    const white = std(0xf8f8f5, 0.9)
    const black = std(0x1a1a1a, 0.85)
    const h = rig.skull
    add(h, shapeHead(new THREE.SphereGeometry(1, 48, 36), s), white)
    for (const side of [1, -1]) {
        add(h, new THREE.SphereGeometry(0.3, 24, 16), black, [side * 0.72, 0.7, -0.05], [1, 1, 0.75])
        const patch = add(h, new THREE.SphereGeometry(1, 24, 16), black, [side * 0.33, 0.06, surfaceZ(s, side * 0.33, 0.06) - 0.07], [0.2, 0.27, 0.1], [0, side * 0.35, side * 0.55])
        patch.renderOrder = 0
    }
    const muzzleZ = surfaceZ(s, 0, -0.32)
    add(h, new THREE.SphereGeometry(1, 32, 24), white, [0, -0.32, muzzleZ - 0.1], [0.4, 0.28, 0.3])
    add(h, new THREE.SphereGeometry(1, 24, 16), glossy(0x111111), [0, -0.2, muzzleZ + 0.18], [0.13, 0.085, 0.09])
    addEyes(rig, s, { r: 0.085, iris: 0x1b1b1b, irisAngle: 1.0, pupilAngle: 0.5, lid: black, lidOpen: 50, lash: null }, 0.33, 0.08, 0.1)
    addBrows(rig, s, black, 0.3, 0.33, 0.12, 0.025, 0.015)
    rig.mouth = new Mouth(0.24, 0.6, 0.3, { lip: null, closedGap: 0.04, cavity: 0x4a1218 })
    rig.mouth.group.position.set(0, -0.43, muzzleZ + 0.15)
    h.add(rig.mouth.group)
    addTorso(rig, white, white, { width: 1.05, neck: 0.66 })
    for (const side of [1, -1]) add(rig.body, new THREE.SphereGeometry(1, 24, 16), black, [side * 1.05, -1.8, -0.1], [0.5, 0.75, 0.55])
    return rig
}

function buildPenguin(): Rig {
    const rig = newRig([0xbae6fd, 0x0c4a6e])
    const s: HeadShape = { sx: 0.95, sy: 1.0, sz: 0.92, jaw: 0.15 }
    const black = std(0x1f2937, 0.5, 0.05)
    const white = std(0xfafafa, 0.7)
    const orange = std(0xf59e0b, 0.45)
    const h = rig.skull
    add(h, shapeHead(new THREE.SphereGeometry(1, 48, 36), s), black)
    add(h, shell(s, 1.012, 0.35, Math.PI - 0.7, Math.PI * 0.32, Math.PI * 0.6), white)
    const beakZ = surfaceZ(s, 0, -0.2)
    add(h, new THREE.ConeGeometry(0.17, 0.45, 24), orange, [0, -0.15, beakZ + 0.18], [1.2, 1, 0.6], [Math.PI / 2, 0, 0])
    const lowerBeak = new THREE.Group()
    lowerBeak.position.set(0, -0.22, beakZ - 0.02)
    add(lowerBeak, new THREE.ConeGeometry(0.13, 0.36, 24), std(0xd97706, 0.45), [0, 0, 0.17], [1.1, 1, 0.45], [Math.PI / 2, 0, 0])
    h.add(lowerBeak)
    addEyes(rig, s, { r: 0.11, iris: 0x1e293b, irisAngle: 0.9, pupilAngle: 0.5, lid: white, lidOpen: 50, lash: null }, 0.3, 0.14, 0.45)
    addBrows(rig, s, black, 0.31, 0.36, 0.15, 0.022, 0.015)
    addTorso(rig, black, black, { width: 1.0, neck: 0.7 })
    add(rig.body, new THREE.SphereGeometry(1, 24, 16), white, [0, -1.9, 0.3], [0.75, 0.6, 0.25])
    rig.extra = (e) => { lowerBeak.rotation.x = e.jaw * 0.55 + e.pucker * 0.1 }
    return rig
}

function buildAlien(): Rig {
    const rig = newRig([0x7c3aed, 0x0f0a2a])
    const s: HeadShape = { sx: 0.9, sy: 1.15, sz: 0.88, jaw: 0.55 }
    const skin = new THREE.MeshPhysicalMaterial({ color: 0x6ee787, roughness: 0.42, clearcoat: 0.4, sheen: 0.4, sheenColor: new THREE.Color(0xbaffc9) })
    const h = rig.skull
    add(h, shapeHead(new THREE.SphereGeometry(1, 48, 36), s), skin)
    const eyes: THREE.Object3D[] = []
    for (const side of [1, -1]) {
        const eye = new THREE.Group()
        eye.position.set(side * 0.36, 0.0, surfaceZ(s, side * 0.36, 0) - 0.12)
        eye.rotation.z = side * 0.4
        add(eye, new THREE.SphereGeometry(0.26, 32, 24), glossy(0x050608, { roughness: 0.05 }), [0, 0, 0], [1.3, 0.75, 0.55])
        add(eye, new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), [0.08, 0.08, 0.15])
        h.add(eye)
        eyes.push(eye)
    }
    rig.mouth = placeMouth(h, s, -0.68, 0.22, { lip: null, teeth: false, closedGap: 0.04, cavity: 0x14532d })
    const antennaMat = new THREE.MeshStandardMaterial({ color: 0xa7f3d0, emissive: 0x34d399, emissiveIntensity: 0.6 })
    const bulbs: THREE.Mesh[] = []
    for (const side of [1, -1]) {
        add(h, new THREE.CylinderGeometry(0.025, 0.03, 0.55, 8), skin, [side * 0.3, s.sy * 0.98 + 0.15, -0.05], undefined, [0, 0, -side * 0.35])
        bulbs.push(add(h, new THREE.SphereGeometry(0.08, 16, 12), antennaMat, [side * 0.4, s.sy * 0.98 + 0.42, -0.05]))
    }
    addTorso(rig, std(0x4c1d95, 0.5, 0.3), skin, { width: 0.9, neck: 0.26, collar: std(0xa78bfa, 0.3, 0.6) })
    rig.extra = (e, now) => {
        eyes.forEach((eye, i) => {
            const blink = i === 0 ? e.blinkL : e.blinkR
            eye.scale.y = Math.max(0.08, 1 - blink)
            eye.rotation.y = e.lookX * 0.25
        })
        antennaMat.emissiveIntensity = 0.5 + e.jaw * 2 + Math.sin(now / 300) * 0.15
        bulbs.forEach((b, i) => { b.position.x = (i ? -1 : 1) * 0.4 + Math.sin(now / 500 + i) * 0.02 })
    }
    return rig
}

function buildRobot(): Rig {
    const rig = newRig([0x334155, 0x020617])
    const metal = std(0xb8c2cf, 0.28, 0.85)
    const darkMetal = std(0x2a3240, 0.4, 0.7)
    const visor = new THREE.MeshPhysicalMaterial({ color: 0x0b1220, roughness: 0.08, metalness: 0.3, clearcoat: 1 })
    const glow = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.6 })
    const h = rig.skull
    add(h, new RoundedBoxGeometry(1.7, 1.55, 1.4, 6, 0.28), metal)
    add(h, new RoundedBoxGeometry(1.4, 0.75, 0.2, 4, 0.12), visor, [0, 0.08, 0.66])
    for (const side of [1, -1]) {
        add(h, new THREE.CylinderGeometry(0.24, 0.24, 0.16, 32), darkMetal, [side * 0.9, 0, 0], undefined, [0, 0, Math.PI / 2])
        add(h, new THREE.TorusGeometry(0.16, 0.025, 8, 32), glow, [side * 0.99, 0, 0], undefined, [0, Math.PI / 2, 0])
    }
    add(h, new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), darkMetal, [0, 0.98, 0])
    const bulb = add(h, new THREE.SphereGeometry(0.1, 20, 16), glow.clone(), [0, 1.24, 0])

    for (const side of [1, -1] as const) {
        const eye = buildEye({ r: 0.13, iris: 0x22d3ee, emissive: true })
        eye.root.position.set(side * 0.33, 0.16, 0.72)
        eye.root.scale.set(1.3, 1, 0.3)
        h.add(eye.root)
        rig.eyes.push(eye)
        const brow = new THREE.Group()
        add(brow, new THREE.BoxGeometry(0.34, 0.05, 0.04), glow)
        brow.rotation.y = 0
        brow.position.set(side * 0.33, 0.38, 0.77)
        h.add(brow)
        rig.brows.push({ pivot: brow, side, baseY: 0.38, range: 0.08 })
    }

    // LED equaliser mouth
    const bars: THREE.Mesh[] = []
    for (let i = 0; i < 9; i++) bars.push(add(h, new THREE.BoxGeometry(0.07, 0.06, 0.03), glow, [(i - 4) * 0.095, -0.2, 0.77]))
    add(rig.body, new THREE.CylinderGeometry(0.25, 0.32, 0.6, 24), darkMetal, [0, -1.35, 0])
    add(rig.body, new RoundedBoxGeometry(2.4, 1.0, 1.1, 4, 0.3), metal, [0, -2.2, -0.05])
    const chest = add(rig.body, new THREE.CircleGeometry(0.16, 32), glow, [0, -2.0, 0.51])
    rig.extra = (e, now) => {
        const talk = e.jaw
        bars.forEach((bar, i) => {
            const u = (i - 4) / 4
            const wave = 0.5 + 0.5 * Math.sin(now / 70 + i * 1.7)
            bar.scale.y = 1 + talk * (5 - Math.abs(u) * 3) * (0.6 + 0.4 * wave)
            bar.position.y = -0.2 + (e.smileL + e.smileR) * 0.5 * u * u * 0.12 - e.frown * u * u * 0.08
        })
        const m = bulb.material as THREE.MeshStandardMaterial
        m.emissiveIntensity = 1 + talk * 3 + Math.sin(now / 400) * 0.3
        chest.scale.setScalar(1 + Math.sin(now / 600) * 0.06)
    }
    return rig
}

type Builder = () => Rig

const BUILDERS: Record<Avatar3DStyle, Builder> = {
    'human-alex': () => buildHuman(PEOPLE['human-alex']),
    'human-maya': () => buildHuman(PEOPLE['human-maya']),
    'human-kofi': () => buildHuman(PEOPLE['human-kofi']),
    'human-hana': () => buildHuman(PEOPLE['human-hana']),
    'human-ravi': () => buildHuman(PEOPLE['human-ravi']),
    'human-elder': () => buildHuman(PEOPLE['human-elder']),
    'astronaut': () => buildHuman(PEOPLE['astronaut']),
    'toon-kid': () => buildHuman(PEOPLE['toon-kid']),
    'toon-hero': () => buildHuman(PEOPLE['toon-hero']),
    robot3d: buildRobot,
    alien3d: buildAlien,
    bear3d: buildBear,
    cat3d: buildCat,
    fox3d: buildFox,
    panda3d: buildPanda,
    penguin3d: buildPenguin,
}

function disposeObject(root: THREE.Object3D) {
    const materials = new Set<THREE.Material>()
    root.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const m = mesh.material
        if (Array.isArray(m)) m.forEach(x => materials.add(x))
        else if (m) materials.add(m)
    })
    materials.forEach(m => m.dispose())
}

// ── Renderer + tracking ───────────────────────────────────────────────────────

const FRAME_INTERVAL = 1000 / 30

export class Avatar3D {
    private canvas: HTMLCanvasElement
    private renderer: THREE.WebGLRenderer
    private scene = new THREE.Scene()
    private camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100)
    private environment: THREE.Texture | null = null
    private backgroundTexture: THREE.Texture | null = null
    private rig: Rig | null = null
    private style: Avatar3DStyle | null = null
    private tracker: FaceTracker | null = null
    // Face tracking at up to the camera rate (~30/s), slower when inference is slow on this device
    private trackRate = new AdaptiveInterval(30, 100, 20)
    private stream: MediaStream | null = null
    private disposed = false
    private cancelFrame: (() => void) | null = null
    private running = false
    private lastVideoTime = -1
    private lastTrackAt = 0
    private lastRenderAt = 0
    private lastFaceAt = -Infinity
    private nextIdleBlink = 0
    private targetRotation = new THREE.Quaternion()
    private targetOffset = new THREE.Vector3()
    private offset = new THREE.Vector3()
    private expression: Expression = { ...NEUTRAL }
    private targetExpression: Expression = { ...NEUTRAL }
    private euler = new THREE.Euler()
    private matrix = new THREE.Matrix4()
    private scratchPos = new THREE.Vector3()
    private scratchScale = new THREE.Vector3()
    private scratchQuat = new THREE.Quaternion()
    public onLoadError?: (err: unknown) => void

    constructor() {
        this.canvas = document.createElement('canvas')
        this.canvas.width = 640
        this.canvas.height = 480
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
        this.renderer.setPixelRatio(1)
        this.renderer.setSize(640, 480, false)
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping
        this.renderer.toneMappingExposure = 1.05
        this.renderer.outputColorSpace = THREE.SRGBColorSpace

        this.camera.position.set(0, -0.3, 7.4)
        this.camera.lookAt(0, -0.42, 0)

        // Studio lighting: soft image-based fill plus a warm key, cool fill and a rim light
        const pmrem = new THREE.PMREMGenerator(this.renderer)
        const room = new RoomEnvironment()
        this.environment = pmrem.fromScene(room, 0.04).texture
        room.dispose()
        pmrem.dispose()
        this.scene.environment = this.environment
        this.scene.environmentIntensity = 0.55
        this.scene.add(new THREE.HemisphereLight(0xe8efff, 0x40303a, 0.7))
        const key = new THREE.DirectionalLight(0xfff1e0, 1.8)
        key.position.set(2.5, 3, 4.5)
        const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6)
        fill.position.set(-3.5, 1, 3)
        const rim = new THREE.DirectionalLight(0xffffff, 1.5)
        rim.position.set(-1, 3, -4)
        this.scene.add(key, fill, rim)
    }

    public setStyle(style: Avatar3DStyle) {
        if (style === this.style && this.rig) return
        this.style = style
        if (this.rig) {
            this.scene.remove(this.rig.root)
            disposeObject(this.rig.root)
            this.rig = null
        }
        this.backgroundTexture?.dispose()
        // Only the selected avatar is ever built
        this.rig = BUILDERS[style]()
        this.backgroundTexture = gradientTexture(...this.rig.background)
        this.scene.background = this.backgroundTexture
        this.scene.add(this.rig.root)
        this.renderer.compile(this.scene, this.camera)
    }

    private requestTracker() {
        if (this.tracker || this.disposed) return
        this.tracker = acquireFaceTracker()
        this.tracker.ready.catch(err => {
            console.error('[Avatar3D] Failed to load face tracking:', err)
            this.onLoadError?.(err)
        })
    }

    private track(video: HTMLVideoElement, now: number) {
        if (!this.tracker || video.readyState < 2 || !video.videoWidth) return
        if (video.currentTime === this.lastVideoTime || now - this.lastTrackAt < this.trackRate.current - 2) return
        this.lastVideoTime = video.currentTime
        this.lastTrackAt = now

        const result = this.tracker.detect(video)
        if (!result) return
        this.trackRate.record(this.tracker.lastCostMs())
        const matrix = result.facialTransformationMatrixes?.[0]
        const shapes = result.faceBlendshapes?.[0]?.categories
        if (!matrix || !shapes) return
        this.lastFaceAt = now

        this.matrix.fromArray(matrix.data).decompose(this.scratchPos, this.scratchQuat, this.scratchScale)
        this.euler.setFromQuaternion(this.scratchQuat, 'YXZ')
        this.euler.set(
            THREE.MathUtils.clamp(this.euler.x, -0.6, 0.6),
            THREE.MathUtils.clamp(this.euler.y, -0.85, 0.85),
            THREE.MathUtils.clamp(this.euler.z, -0.6, 0.6), 'YXZ')
        this.targetRotation.setFromEuler(this.euler)
        // Translation is in centimetres relative to the camera: a gentle sway, not a 1:1 move
        this.targetOffset.set(
            THREE.MathUtils.clamp(this.scratchPos.x * 0.012, -0.3, 0.3),
            THREE.MathUtils.clamp(this.scratchPos.y * 0.012, -0.2, 0.2), 0)

        const score: Record<string, number> = {}
        for (const c of shapes) score[c.categoryName] = c.score
        const g = (name: string) => score[name] ?? 0
        const smileL = remap(g('mouthSmileLeft'), 0.06, 0.65)
        const smileR = remap(g('mouthSmileRight'), 0.06, 0.65)
        this.targetExpression = {
            blinkL: remap(g('eyeBlinkLeft'), 0.22, 0.62),
            blinkR: remap(g('eyeBlinkRight'), 0.22, 0.62),
            squintL: Math.max(remap(g('eyeSquintLeft'), 0.2, 0.7), smileL * 0.4),
            squintR: Math.max(remap(g('eyeSquintRight'), 0.2, 0.7), smileR * 0.4),
            jaw: remap(g('jawOpen'), 0.04, 0.6),
            smileL,
            smileR,
            frown: remap((g('mouthFrownLeft') + g('mouthFrownRight')) / 2, 0.06, 0.45),
            pucker: remap(Math.max(g('mouthPucker'), g('mouthFunnel')), 0.15, 0.7),
            browInner: remap(g('browInnerUp'), 0.06, 0.6),
            browOuterL: remap(g('browOuterUpLeft'), 0.06, 0.6),
            browOuterR: remap(g('browOuterUpRight'), 0.06, 0.6),
            browDownL: remap(g('browDownLeft'), 0.08, 0.55),
            browDownR: remap(g('browDownRight'), 0.08, 0.55),
            lookX: THREE.MathUtils.clamp((g('eyeLookOutLeft') - g('eyeLookInLeft') + g('eyeLookInRight') - g('eyeLookOutRight')) / 2 * 1.4, -1, 1),
            lookY: THREE.MathUtils.clamp(((g('eyeLookUpLeft') + g('eyeLookUpRight')) - (g('eyeLookDownLeft') + g('eyeLookDownRight'))) / 2 * 1.4, -1, 1),
        }
    }

    private animate(now: number, dt: number) {
        const rig = this.rig
        if (!rig) return

        // Without a face for a while, ease into a living idle pose (sway + occasional blink)
        if (now - this.lastFaceAt > 800) {
            this.euler.set(Math.sin(now / 1400) * 0.05, Math.sin(now / 1900) * 0.12, Math.sin(now / 2300) * 0.03, 'YXZ')
            this.targetRotation.setFromEuler(this.euler)
            this.targetOffset.set(0, 0, 0)
            const blink = now > this.nextIdleBlink && now < this.nextIdleBlink + 140 ? 1 : 0
            if (now > this.nextIdleBlink + 140) this.nextIdleBlink = now + 2500 + Math.random() * 3000
            this.targetExpression = { ...NEUTRAL, blinkL: blink, blinkR: blink }
        }

        // Adaptive smoothing: small jittery changes are damped heavily, big moves follow quickly
        const angle = rig.head.quaternion.angleTo(this.targetRotation)
        rig.head.quaternion.slerp(this.targetRotation, 1 - Math.exp(-dt * (8 + 70 * angle)))
        this.offset.lerp(this.targetOffset, 1 - Math.exp(-dt * 6))
        const e = this.expression
        const t = this.targetExpression
        for (const key of Object.keys(e) as (keyof Expression)[]) e[key] += (t[key] - e[key]) * (1 - Math.exp(-dt * RATES[key]))

        // Each eye of the avatar mirrors the same eye of the user (avatar's left = +x)
        rig.eyes.forEach((eye, i) => updateEye(eye, i === 0 ? e.blinkL : e.blinkR, i === 0 ? e.squintL : e.squintR, e.lookX, e.lookY))
        rig.brows.forEach(b => updateBrow(b, e))
        rig.mouth?.update(e)
        if (rig.jaw) rig.jaw.position.y = -e.jaw * rig.jawRange
        rig.extra?.(e, now)

        this.euler.setFromQuaternion(rig.head.quaternion, 'YXZ')
        rig.body.rotation.y = this.euler.y * 0.25
        rig.body.position.y = Math.sin(now / 1300) * 0.015
        rig.root.position.set(this.offset.x, this.offset.y + Math.sin(now / 1300) * 0.01, 0)
    }

    public start(video: HTMLVideoElement): MediaStream {
        this.stop()
        if (!this.rig) this.setStyle(this.style ?? 'human-alex')
        this.running = true
        this.requestTracker()
        this.lastRenderAt = 0

        const loop = (now: number) => {
            if (!this.running) return
            this.cancelFrame = requestFrame(loop)
            try {
                this.track(video, now)
            } catch (err) {
                console.warn('[Avatar3D] Tracking error:', err)
            }
            // Render at ~30fps (the rate the stream is captured at) to keep laptops cool
            if (now - this.lastRenderAt < FRAME_INTERVAL - 2) return
            const dt = this.lastRenderAt ? Math.min(0.1, (now - this.lastRenderAt) / 1000) : 1 / 30
            this.lastRenderAt = now
            this.animate(now, dt)
            this.renderer.render(this.scene, this.camera)
        }
        this.cancelFrame = requestFrame(loop)
        // Draw one frame immediately so the stream never starts black
        this.animate(performance.now(), 1 / 30)
        this.renderer.render(this.scene, this.camera)
        // One capture track for the life of the avatar: a new one per start() would leave the old
        // tracks capturing the same canvas
        if (!this.stream || this.stream.getVideoTracks().every(t => t.readyState === 'ended')) this.stream = this.canvas.captureStream(30)
        return this.stream
    }

    public stop() {
        this.running = false
        this.cancelFrame?.()
        this.cancelFrame = null
    }

    public dispose() {
        this.stop()
        this.disposed = true
        this.tracker?.release()
        this.tracker = null
        this.stream?.getTracks().forEach(t => t.stop())
        this.stream = null
        if (this.rig) disposeObject(this.rig.root)
        this.rig = null
        this.backgroundTexture?.dispose()
        this.environment?.dispose()
        this.renderer.dispose()
    }
}
