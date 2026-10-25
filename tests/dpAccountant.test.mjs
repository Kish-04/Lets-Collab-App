// Differential privacy for federated learning: the accountant's numbers and the noise devices add.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/loadTs.mjs'

const { gaussianEpsilon, roundsWithinBudget } = await loadTs('lib/dpAccountant.ts')
const { buildContribution } = await loadTs('lib/secureAggregation.ts')

test('epsilon grows with rounds, shrinks with noise, and is infinite without noise', () => {
  const one = gaussianEpsilon(1, 1, 1e-5)
  // Closed form at the best order: about 5.3 for one round at sigma 1, delta 1e-5
  assert.ok(one > 5 && one < 5.6, `epsilon(1 round) = ${one}`)
  assert.ok(gaussianEpsilon(10, 1) > one)
  assert.ok(gaussianEpsilon(10, 2) < gaussianEpsilon(10, 1))
  assert.equal(gaussianEpsilon(5, 0), Infinity)
  assert.equal(gaussianEpsilon(0, 1), 0)
})

test('the round budget is the largest number of rounds that stays within epsilon', () => {
  const rounds = roundsWithinBudget(8, 1, 1e-5)
  assert.ok(rounds >= 1)
  assert.ok(gaussianEpsilon(rounds, 1) <= 8)
  assert.ok(gaussianEpsilon(rounds + 1, 1) > 8)
  assert.ok(roundsWithinBudget(8, 2) > rounds, 'more noise buys more rounds')
})

test('each device adds its share of the noise, and the shares add up to sigma', () => {
  const devices = 4
  const samples = 4000
  const sums = new Float64Array(samples)
  for (let d = 0; d < devices; d++) {
    const v = buildContribution(new Float64Array(samples), 50, 1, 1, devices, true)
    assert.equal(v[samples], 1, 'equal weighting: every device counts once')
    for (let i = 0; i < samples; i++) sums[i] += v[i]
  }
  const std = arr => Math.sqrt(arr.reduce((t, x) => t + x * x, 0) / arr.length)
  const one = buildContribution(new Float64Array(samples), 50, 1, 1, devices, true).slice(0, samples)
  assert.ok(Math.abs(std(one) - 0.5) < 0.05, `per-device std ${std(one)} (expected 1 / sqrt(4))`)
  assert.ok(Math.abs(std(sums) - 1) < 0.08, `aggregate std ${std(sums)} (expected sigma = 1)`)
})

test('without noise the contribution is the clipped, sample-weighted delta as before', () => {
  const v = Array.from(buildContribution([3, 4], 10, 1, 0))
  ;[6, 8, 10].forEach((expected, i) => assert.ok(Math.abs(v[i] - expected) < 1e-9, `${v[i]} vs ${expected}`))
})
