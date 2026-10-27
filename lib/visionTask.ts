// One shared, on-device MediaPipe vision task (face landmarker, object detector) per page.
//
// - Every consumer (3D avatar, image avatar, exam proctoring, calibration) holds a handle on the same
//   instance, so a model is loaded and kept on the GPU once, not once per feature.
// - detect() runs the model at most once per camera frame: a second consumer asking for the same frame
//   gets the cached result instead of a second inference.
// - Large camera frames are scaled down before inference (the models work on 128-320 px inputs).
// - The GPU delegate reads its results back from the GPU every frame. On machines where that is slow
//   (software WebGL, weak integrated GPUs) the task moves itself to the CPU (WebAssembly + XNNPACK).
// Assets are local (/wasm, /models), so this works offline and in the desktop app.
import type { FilesetResolver } from '@mediapipe/tasks-vision'

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

type Delegate = 'GPU' | 'CPU'

interface Closable { close(): void }

let fileset: Promise<WasmFileset> | null = null
export function visionFileset(): Promise<WasmFileset> {
    if (!fileset) {
        fileset = import('@mediapipe/tasks-vision').then(({ FilesetResolver }) => FilesetResolver.forVisionTasks('/wasm'))
        fileset.catch(() => { fileset = null })
    }
    return fileset
}

// detectForVideo needs strictly increasing timestamps on every instance; one clock for all of them
let lastTimestamp = 0
export function nextVisionTimestamp() {
    lastTimestamp = Math.max(lastTimestamp + 1, Math.floor(performance.now()))
    return lastTimestamp
}

export type VisionSource = HTMLVideoElement | HTMLCanvasElement

export interface VisionTaskHandle<R> {
    /** Resolves once the model is loaded (rejects when it cannot load) */
    ready: Promise<void>
    /** Runs (or reuses) inference on the current frame of `source`; null while loading or on error */
    detect(source: VisionSource): R | null
    /** Milliseconds the last real inference took (0 before the first one) */
    lastCostMs(): number
    release(): void
}

export interface VisionTaskSpec<T extends Closable, R, Need> {
    name: string
    create(fileset: WasmFileset, delegate: Delegate, need: Need): Promise<T>
    run(task: T, input: VisionSource, timestamp: number): R
    /** Combined requirement of all current holders (e.g. the largest numFaces) */
    merge(needs: Need[]): Need
    sameNeed(a: Need, b: Need): boolean
    /** Re-applies options to a live instance when the combined requirement changes */
    reconfigure?(task: T, need: Need): Promise<void>
    /** Frames wider than this are scaled down first */
    maxInputWidth: number
}

const SLOW_GPU_MS = 25
const SAMPLES_BEFORE_JUDGING = 12

export class SharedVisionTask<T extends Closable, R, Need> {
    private instance: Promise<T> | null = null
    private task: T | null = null
    private delegate: Delegate = 'GPU'
    private triedCpu = false
    private busy = false
    private holders = new Map<number, Need>()
    private nextId = 1
    private applied: Need | null = null
    private costs: number[] = []
    private cache: { source: VisionSource; key: number; result: R } | null = null
    private scaleCanvas: HTMLCanvasElement | null = null
    private scaleCtx: CanvasRenderingContext2D | null = null
    private lastCost = 0

    constructor(private spec: VisionTaskSpec<T, R, Need>) { }

    acquire(need: Need): VisionTaskHandle<R> {
        const id = this.nextId++
        this.holders.set(id, need)
        const ready = this.ensure().then(() => this.syncOptions())
        let released = false
        return {
            ready,
            detect: (source) => released ? null : this.detect(source),
            lastCostMs: () => this.lastCost,
            release: () => {
                if (released) return
                released = true
                this.holders.delete(id)
                if (this.holders.size === 0) this.close()
                else void this.syncOptions()
            },
        }
    }

    private need() {
        return this.spec.merge(Array.from(this.holders.values()))
    }

    private ensure(): Promise<T> {
        if (!this.instance) {
            const pending = this.build('GPU')
            this.instance = pending
            pending.catch(() => { if (this.instance === pending) this.instance = null })
        }
        return this.instance
    }

    private async build(prefer: Delegate): Promise<T> {
        const files = await visionFileset()
        const need = this.need()
        let task: T
        try {
            task = await this.spec.create(files, prefer, need)
            this.delegate = prefer
        } catch (err) {
            if (prefer === 'CPU') throw err
            console.warn(`[${this.spec.name}] GPU delegate unavailable, using the CPU.`, err)
            task = await this.spec.create(files, 'CPU', need)
            this.delegate = 'CPU'
            this.triedCpu = true
        }
        if (this.holders.size === 0) {
            task.close()
            throw new Error(`${this.spec.name} released while loading`)
        }
        this.task = task
        this.applied = need
        this.costs = []
        return task
    }

    private async syncOptions() {
        const task = this.task
        if (!task || !this.spec.reconfigure || this.holders.size === 0) return
        const need = this.need()
        if (this.applied && this.spec.sameNeed(this.applied, need)) return
        this.applied = need
        this.busy = true
        try {
            await this.spec.reconfigure(task, need)
        } catch (err) {
            console.warn(`[${this.spec.name}] Could not apply options`, err)
        } finally {
            this.busy = false
        }
    }

    private input(source: VisionSource): VisionSource | null {
        const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width
        const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height
        if (!width || !height) return null
        if (width <= this.spec.maxInputWidth) return source
        if (!this.scaleCanvas) {
            this.scaleCanvas = document.createElement('canvas')
            this.scaleCtx = this.scaleCanvas.getContext('2d', { alpha: false })
        }
        const w = this.spec.maxInputWidth
        const h = Math.round(height * (w / width))
        if (this.scaleCanvas.width !== w || this.scaleCanvas.height !== h) {
            this.scaleCanvas.width = w
            this.scaleCanvas.height = h
        }
        this.scaleCtx?.drawImage(source, 0, 0, w, h)
        return this.scaleCanvas
    }

    private detect(source: VisionSource): R | null {
        const task = this.task
        if (!task || this.busy) return null
        if (source instanceof HTMLVideoElement && (source.readyState < 2 || !source.videoWidth)) return null
        // Same frame of the same video as the last call: share the result
        const key = source instanceof HTMLVideoElement ? source.currentTime : NaN
        if (this.cache && this.cache.source === source && this.cache.key === key) return this.cache.result
        const input = this.input(source)
        if (!input) return null
        const started = performance.now()
        let result: R
        try {
            result = this.spec.run(task, input, nextVisionTimestamp())
        } catch (err) {
            console.warn(`[${this.spec.name}] Inference failed`, err)
            return null
        }
        this.lastCost = performance.now() - started
        this.cache = { source, key, result }
        this.judgeDelegate(this.lastCost)
        return result
    }

    // Moves a slow GPU instance to the CPU once (the cost of the first frames is not counted)
    private judgeDelegate(cost: number) {
        if (this.delegate !== 'GPU' || this.triedCpu) return
        this.costs.push(cost)
        if (this.costs.length < SAMPLES_BEFORE_JUDGING + 3) return
        const sorted = this.costs.slice(3).sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        this.costs = []
        if (median <= SLOW_GPU_MS) {
            this.triedCpu = true // fast enough: stay on the GPU
            return
        }
        this.triedCpu = true
        console.info(`[${this.spec.name}] GPU inference takes ${median.toFixed(0)} ms per frame; moving to the CPU.`)
        const previous = this.task
        const pending = this.build('CPU')
        pending.then(() => {
            this.instance = pending
            this.cache = null
            previous?.close()
        }).catch(err => {
            // Keep the GPU instance (unless everyone let go meanwhile; then it was closed)
            if (this.holders.size > 0 && !this.task) this.task = previous
            console.warn(`[${this.spec.name}] CPU delegate unavailable`, err)
        })
    }

    private close() {
        const pending = this.instance
        this.instance = null
        this.task = null
        this.applied = null
        this.cache = null
        this.triedCpu = false
        this.costs = []
        pending?.then(task => task.close()).catch(() => { })
    }
}
