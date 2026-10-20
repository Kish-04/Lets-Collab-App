// Offline check of the voice changer's AudioWorklet pitch shifter: node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from './helpers/loadTs.mjs'

const source = fs.readFileSync(path.join(repoRoot, 'lib', 'VoiceChanger.ts'), 'utf8')
const processorCode = source.split('const PITCH_SHIFT_PROCESSOR = `')[1].split('`;')[0]
let Processor
globalThis.AudioWorkletProcessor = class {}
globalThis.registerProcessor = (_, cls) => { Processor = cls }
new Function(processorCode)()

const SAMPLE_RATE = 48000

function dominantFrequency(samples) {
  let best = 0, bestFreq = 0
  for (let f = 80; f < 600; f += 2) {
    let re = 0, im = 0
    for (let i = 0; i < samples.length; i++) {
      re += samples[i] * Math.cos((2 * Math.PI * f * i) / SAMPLE_RATE)
      im += samples[i] * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE)
    }
    if (re * re + im * im > best) { best = re * re + im * im; bestFreq = f }
  }
  return bestFreq
}

for (const pitch of [0.7, 1.2, 1.7]) {
  test(`shifts a 200 Hz tone by x${pitch}`, () => {
    const processor = new Processor()
    const output = []
    for (let block = 0; block < SAMPLE_RATE / 128; block++) {
      const input = new Float32Array(128)
      for (let i = 0; i < 128; i++) input[i] = Math.sin((2 * Math.PI * 200 * (block * 128 + i)) / SAMPLE_RATE)
      const out = [new Float32Array(128)]
      processor.process([[input]], [out], { pitch: [pitch] })
      output.push(...out[0])
    }
    const frequency = dominantFrequency(output.slice(SAMPLE_RATE / 2))
    assert.ok(Math.abs(frequency - 200 * pitch) <= 12, `expected ~${200 * pitch} Hz, got ${frequency} Hz`)
  })
}
