// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { createSim, createSpotScene, resolveConfig, type Scene } from "../src/index.ts"

/** A flat scene (brightness 1) where the listed pixels jump to `factor` from time `atMs` on. */
function stepScene(atMs: number, pixels: ReadonlyArray<readonly [number, number]>, factor = Math.exp(0.3)): Scene {
  let t = 0
  const lit = new Set(pixels.map(([x, y]) => `${x},${y}`))
  return {
    advance(dt) {
      t += dt
    },
    brightness(x, y) {
      return t >= atMs && lit.has(`${x - 0.5},${y - 0.5}`) ? factor : 1
    },
    target() {
      return null
    },
  }
}

const argmax = (a: ArrayLike<number>) => {
  let best = 0
  for (let i = 1; i < a.length; i++) if (a[i]! > a[best]!) best = i
  return best
}

describe("sensor", () => {
  test("a still scene gives no events, no spikes and no decoded position", () => {
    const sim = createSim({ scene: createSpotScene({ speedHz: 0 }) })
    sim.step(2000)
    assert.equal(sim.state.totals.events, 0)
    assert.equal(sim.state.totals.spikes, 0)
    assert.equal(sim.state.decoded, null)
    assert.equal(sim.rates().savingRatio, Infinity)
  })

  test("one step change past the threshold gives exactly one event of the right polarity", () => {
    // log change 0.3 > C = 0.22: one ON event, the reference moves by C, the remaining 0.08 is below C
    const sim = createSim({ scene: stepScene(5, [[3, 4]]) })
    sim.step(4)
    assert.equal(sim.state.totals.events, 0)
    sim.step(1)
    assert.equal(sim.state.sensor.eventsLastStep, 1)
    const i = 4 * 24 + 3
    assert.equal(sim.state.sensor.lastPolarity[i], 1)
    assert.equal(sim.state.sensor.lastEventMs[i], 5)
    assert.ok(Math.abs(sim.state.sensor.reference[i]! - 0.22) < 1e-12)
    sim.step(100)
    assert.equal(sim.state.totals.events, 1)
    assert.equal(sim.state.totals.onEvents, 1)
    assert.equal(sim.state.totals.offEvents, 0)
  })

  test("a darkening pixel gives an OFF event", () => {
    const sim = createSim({ scene: stepScene(1, [[0, 0]], Math.exp(-0.3)) })
    sim.step(10)
    assert.equal(sim.state.totals.offEvents, 1)
    assert.equal(sim.state.sensor.lastPolarity[0], -1)
  })

  test("a change of several thresholds is reported one event per step until the reference catches up", () => {
    // log change 0.5: events at steps 1 and 2 (reference 0.22, then 0.44), then 0.06 < C
    const sim = createSim({ scene: stepScene(1, [[0, 0]], Math.exp(0.5)) })
    assert.equal(sim.step(1).events, 1)
    assert.equal(sim.step(1).events, 1)
    assert.equal(sim.step(50).events, 0)
  })

  test("noise events arrive at the configured rate", () => {
    const sim = createSim({ seed: 3, sensor: { noiseHz: 10 }, scene: createSpotScene({ speedHz: 0 }) })
    sim.step(1000)
    const expected = 24 * 16 * 10 // pixels x Hz x 1 s
    const sd = Math.sqrt(expected)
    assert.ok(Math.abs(sim.state.totals.noiseEvents - expected) < 5 * sd, `${sim.state.totals.noiseEvents} noise events`)
    assert.equal(sim.state.totals.events, sim.state.totals.noiseEvents)
  })
})

describe("network", () => {
  test("an event drives the neurons tuned to its column, by the Gaussian weight", () => {
    const sim = createSim({ scene: stepScene(1, [[5, 8]]) })
    sim.step(1)
    const input = sim.state.neurons.inputLastStep
    // preferred positions are (n + 0.5) * 24 / 32; the closest to the pixel centre 5.5 is neuron 7 at 5.625
    assert.equal(argmax(input), 7)
    const pref = sim.state.neurons.preferred
    for (const n of [0, 6, 7, 8, 31]) {
      const expected = 0.16 * Math.exp(-((5.5 - pref[n]!) ** 2) / 2)
      assert.ok(Math.abs(input[n]! - expected) < 1e-12, `neuron ${n}`)
    }
    assert.ok(input[31]! < 1e-20)
  })

  test("the y axis tunes neurons to rows instead", () => {
    const sim = createSim({ neurons: { count: 16 }, receptiveFields: { axis: "y" }, scene: stepScene(1, [[20, 11]]) })
    sim.step(1)
    assert.equal(argmax(sim.state.neurons.inputLastStep), 11)
  })

  test("a custom weight function replaces the Gaussian", () => {
    const sim = createSim({ neurons: { count: 4 }, receptiveFields: { weight: (n, x) => (n === 2 && x === 1 ? 0.5 : 0) }, scene: stepScene(1, [[1, 1]]) })
    sim.step(1)
    assert.deepEqual([...sim.state.neurons.inputLastStep], [0, 0, 0.5, 0])
  })

  test("the membrane potential leaks: v(t + k dt) = v(t) exp(-k dt / tau)", () => {
    const sim = createSim({ scene: stepScene(1, [[5, 8]]) })
    sim.step(1)
    const v0 = sim.state.neurons.potential[7]!
    assert.ok(v0 > 0 && v0 < 1)
    for (let k = 1; k <= 40; k++) {
      sim.step(1)
      const expected = v0 * Math.exp(-k / 20)
      assert.ok(Math.abs(sim.state.neurons.potential[7]! - expected) < 1e-12, `step ${k}`)
    }
  })

  test("crossing the threshold fires one spike, resets to 0 and holds for the refractory period", () => {
    const sim = createSim({ receptiveFields: { gain: 2, sigma: 0.3 }, scene: stepScene(1, [[5, 8]]) })
    sim.step(1)
    assert.deepEqual(sim.state.spikes, [{ timeMs: 1, neuron: 7 }])
    assert.equal(sim.state.neurons.potential[7], 0)
    assert.equal(sim.state.neurons.refractoryLeftMs[7], 3)
    for (const left of [2, 1, 0]) {
      sim.step(1)
      assert.equal(sim.state.neurons.refractoryLeftMs[7], left)
      assert.equal(sim.state.neurons.potential[7], 0)
    }
    assert.equal(sim.state.totals.spikes, 1)
  })

  test("input arriving during the refractory period is ignored", () => {
    // two separate changes on the same pixel column, 2 ms apart: the second lands while neuron 7 is refractory
    let t = 0
    const scene: Scene = {
      advance: (dt) => void (t += dt),
      brightness: (x, y) => (x === 5.5 && (y === 0.5 ? t >= 1 : y === 1.5 ? t >= 3 : false) ? Math.exp(0.3) : 1),
      target: () => null,
    }
    const sim = createSim({ receptiveFields: { gain: 2, sigma: 0.3 }, scene })
    sim.step(10)
    assert.equal(sim.state.totals.events, 2)
    assert.deepEqual(
      sim.state.spikes.filter((s) => s.neuron === 7),
      [{ timeMs: 1, neuron: 7 }],
    )
  })

  test("membrane history returns one sample per step, oldest first, capped at historyMs", () => {
    const sim = createSim({ historyMs: 50, scene: stepScene(1, [[5, 8]]) })
    sim.step(20)
    const m = sim.membrane(7)
    assert.equal(m.length, 20)
    assert.equal(m[19], sim.state.neurons.potential[7])
    assert.ok(m[0]! > m[19]!)
    sim.step(100)
    assert.equal(sim.membrane(7).length, 50)
    assert.throws(() => sim.membrane(32), RangeError)
  })
})

describe("decoder", () => {
  test("follows a moving spot to within a couple of pixels", () => {
    const sim = createSim({ scene: createSpotScene({ speedHz: 0.35 }) })
    sim.step(3000)
    const { rmsErrorPx } = sim.rates()
    assert.ok(rmsErrorPx !== null && rmsErrorPx < 2.5, `rms error ${rmsErrorPx}`)
  })

  test("reports the trace-weighted mean of preferred positions", () => {
    const sim = createSim({ receptiveFields: { gain: 2, sigma: 0.3 }, scene: stepScene(1, [[5, 8]]) })
    sim.step(1)
    // only neuron 7 has fired, so the estimate is exactly its preferred position
    assert.equal(sim.state.decoded, sim.state.neurons.preferred[7])
  })
})

describe("accounting", () => {
  test("operation counts are exact", () => {
    const sim = createSim({ scene: stepScene(10, [[1, 1], [2, 2], [3, 3]]) })
    sim.step(50)
    const t = sim.state.totals
    assert.equal(t.events, 3)
    assert.equal(t.eventDrivenOps, 3 * 32)
    assert.equal(t.clockFrames, 50)
    assert.equal(t.clockedOps, 50 * 24 * 16 * 32)
  })

  test("the clocked processor's frames follow clockHz", () => {
    const sim = createSim({ accounting: { clockHz: 500 }, scene: createSpotScene({ speedHz: 0 }) })
    sim.step(51)
    assert.equal(sim.state.totals.clockFrames, 25)
    assert.equal(sim.rates().clockedOpsPerS, 500 * 384 * 32)
  })

  test("rates cover the sliding window", () => {
    const sim = createSim({ accounting: { windowMs: 100 }, scene: stepScene(10, [[1, 1], [2, 2]]) })
    sim.step(50)
    let r = sim.rates()
    assert.equal(r.windowMs, 50)
    assert.equal(r.eventsPerS, 2 * (1000 / 50))
    assert.equal(r.eventDrivenOpsPerS, r.eventsPerS * 32)
    assert.equal(r.savingRatio, r.clockedOpsPerS / r.eventDrivenOpsPerS)
    sim.step(100) // the two events have left the 100 ms window
    r = sim.rates()
    assert.equal(r.windowMs, 100)
    assert.equal(r.eventsPerS, 0)
  })
})

describe("time and reproducibility", () => {
  test("the same seed gives the same run; a different seed a different one", () => {
    const run = (seed: number) => {
      const sim = createSim({ seed, sensor: { noiseHz: 5 } })
      sim.step(800)
      return { totals: { ...sim.state.totals }, spikes: sim.state.spikes.map((s) => `${s.timeMs}:${s.neuron}`).join(",") }
    }
    assert.deepEqual(run(7), run(7))
    assert.notDeepEqual(run(7).totals, run(8).totals)
  })

  test("time smaller than a step carries over", () => {
    const sim = createSim({ scene: createSpotScene({ speedHz: 0 }) })
    let steps = 0
    for (let i = 0; i < 5; i++) steps += sim.step(0.4).steps
    assert.equal(steps, 2)
    assert.equal(sim.state.timeMs, 2)
    sim.step(0.2)
    assert.equal(sim.state.steps, 2)
    sim.step(0.8)
    assert.equal(sim.state.steps, 3)
  })

  test("reset returns to time 0 with everything cleared", () => {
    const sim = createSim({ sensor: { noiseHz: 5 } })
    sim.step(300)
    assert.ok(sim.state.totals.events > 0)
    sim.reset()
    assert.equal(sim.state.timeMs, 0)
    assert.equal(sim.state.totals.events, 0)
    assert.equal(sim.state.spikes.length, 0)
    assert.equal(sim.membrane(0).length, 0)
    assert.ok(sim.state.neurons.potential.every((v) => v === 0))
  })

  test("setScene re-adapts the sensor silently", () => {
    const sim = createSim({ scene: createSpotScene({ speedHz: 0 }) })
    sim.step(10)
    sim.setScene(createSpotScene({ speedHz: 0, background: 0.5 }))
    sim.step(100)
    assert.equal(sim.state.totals.events, 0)
  })
})

describe("configuration", () => {
  test("defaults match the demo", () => {
    const c = resolveConfig()
    assert.equal(c.sensor.width, 24)
    assert.equal(c.sensor.height, 16)
    assert.equal(c.sensor.contrastThreshold, 0.22)
    assert.equal(c.neurons.count, 32)
    assert.equal(c.neurons.tauMs, 20)
    assert.equal(c.neurons.threshold, 1)
    assert.equal(c.neurons.refractoryMs, 3)
    assert.equal(c.dtMs, 1)
  })

  test("bad settings throw a RangeError that names the setting", () => {
    assert.throws(() => createSim({ neurons: { tauMs: 0 } }), /neurons\.tauMs/)
    assert.throws(() => createSim({ sensor: { width: 2.5 } }), /sensor\.width/)
    assert.throws(() => createSim({ sensor: { noiseHz: -1 } }), /sensor\.noiseHz/)
    assert.throws(() => createSim({ receptiveFields: { preferred: [1, 2] } }), /preferred/)
    assert.throws(() => createSim().step(-1), RangeError)
    assert.throws(() => createSim().setNoiseHz(Number.NaN), RangeError)
  })

  test("a scene with zero brightness is rejected", () => {
    const dark: Scene = { advance() {}, brightness: () => 0, target: () => null }
    assert.throws(() => createSim({ scene: dark }), /brightness must be greater than 0/)
  })
})
