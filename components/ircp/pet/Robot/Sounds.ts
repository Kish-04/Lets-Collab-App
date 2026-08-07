// Procedural Web Audio API sound generators

let audioCtx: AudioContext | null = null
let masterPanner: StereoPannerNode | null = null
let servoOsc: OscillatorNode | null = null
let servoGain: GainNode | null = null
let isAudioInitialized = false

function getContext() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (Ctx) {
      audioCtx = new Ctx()
      
      // Initialize Master Panner
      if (audioCtx.createStereoPanner) {
        masterPanner = audioCtx.createStereoPanner()
        masterPanner.connect(audioCtx.destination)
      }

      // Initialize continuous Servo Hum
      servoOsc = audioCtx.createOscillator()
      servoGain = audioCtx.createGain()
      servoOsc.type = 'sawtooth'
      servoOsc.frequency.value = 40 // Deep sub-bass hum
      servoGain.gain.value = 0.0
      
      servoOsc.connect(servoGain)
      if (masterPanner) {
        servoGain.connect(masterPanner)
      } else {
        servoGain.connect(audioCtx.destination)
      }
      
      servoOsc.start()
      isAudioInitialized = true
    }
  }
  
  // Resume context if suspended (browser autoplay policy)
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  
  return audioCtx
}

// --------------------------------------------------------
// Phase 3: Spatial Audio & Physics Integration
// --------------------------------------------------------

export function updateAudioPosition(panValue: number) {
  // panValue should be between -1 (left) and 1 (right)
  if (masterPanner && masterPanner.pan) {
    // Smoothly ramp to new pan position to avoid clicking
    masterPanner.pan.setTargetAtTime(panValue, audioCtx!.currentTime, 0.1)
  }
}

export function updateServoVelocity(speed: number) {
  if (!servoOsc || !servoGain || !audioCtx) return
  
  // Base idle hum is very quiet and low pitch
  // When speed increases, pitch goes up slightly and volume increases
  const targetPitch = 40 + (speed * 100) // Up to 140Hz
  const targetVolume = Math.min(0.005 + (speed * 0.05), 0.1) // Max volume 0.1
  
  servoOsc.frequency.setTargetAtTime(targetPitch, audioCtx.currentTime, 0.1)
  servoGain.gain.setTargetAtTime(targetVolume, audioCtx.currentTime, 0.1)
}

// Helper to route discrete sounds through the spatial panner
function routeSound(gainNode: GainNode, ctx: AudioContext) {
  if (masterPanner) {
    gainNode.connect(masterPanner)
  } else {
    gainNode.connect(ctx.destination)
  }
}

// --------------------------------------------------------
// Discrete Sound Effects
// --------------------------------------------------------

export function playHoverBeep() {
  const ctx = getContext()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(800, ctx.currentTime)
  gain.gain.setValueAtTime(0.02, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
  osc.connect(gain)
  routeSound(gain, ctx)
  osc.start()
  osc.stop(ctx.currentTime + 0.15)
}

export function playThinkingPulse() {
  const ctx = getContext()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(300, ctx.currentTime)
  // Pulse modulation
  gain.gain.setValueAtTime(0, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.05)
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15)
  
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 800
  
  osc.connect(filter)
  filter.connect(gain)
  routeSound(gain, ctx)
  osc.start()
  osc.stop(ctx.currentTime + 0.2)
}

export function playSuccessChime() {
  const ctx = getContext()
  if (!ctx) return
  const notes = [440, 554.37, 659.25, 880] // A4, C#5, E5, A5
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    
    const startTime = ctx.currentTime + i * 0.1
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(0.04, startTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4)
    
    osc.connect(gain)
    routeSound(gain, ctx)
    osc.start(startTime)
    osc.stop(startTime + 0.5)
  })
}

export function playWarningTone() {
  const ctx = getContext()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sawtooth'
  
  // Descending note
  osc.frequency.setValueAtTime(400, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3)
  
  gain.gain.setValueAtTime(0.05, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
  
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(2000, ctx.currentTime)
  filter.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3)
  
  osc.connect(filter)
  filter.connect(gain)
  routeSound(gain, ctx)
  
  osc.start()
  osc.stop(ctx.currentTime + 0.4)
}

export function playBlip(freq: number) {
  const ctx = getContext()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.05, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
  osc.connect(gain)
  routeSound(gain, ctx)
  osc.start()
  osc.stop(ctx.currentTime + 0.2)
}
