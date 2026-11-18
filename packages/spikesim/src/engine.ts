// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

// The headless simulator: an event camera feeding a population of leaky integrate-and-fire neurons, a
// population-vector decoder, and exact operation counts. Plain TypeScript, no DOM, deterministic for a given seed.
//
// One step of dtMs, in order:
//   1. scene.advance(dt)
//   2. sensor: every pixel compares log brightness with the level it last reported; past the contrast threshold C it
//      emits one ON or OFF event and moves its reference by C. Otherwise it may emit a noise event.
//      Each event adds its weight to every neuron: `count` synaptic additions.
//   3. neurons: refractory neurons stay at 0; the rest leak (v *= exp(-dt / tau)), add their input, and fire on
//      reaching the threshold, which resets v to 0 and starts the refractory period.
//   4. decoder: each spike bumps a per-neuron trace (decaying with traceTauMs); the estimate is the trace-weighted
//      mean of the neurons' preferred positions.
//   5. accounting: totals and a sliding window for per-second rates.

import { createRandom } from "./random.ts"
import { buildWeights, evenlySpaced, type ReceptiveFieldConfig } from "./receptive-fields.ts"
import { createSpotScene, type Point, type Scene } from "./scene.ts"

export interface SensorConfig {
  /** Pixels across. Default 24. */
  width: number
  /** Pixels down. Default 16. */
  height: number
  /** Contrast threshold C: the change in natural-log brightness that triggers an event. Default 0.22. */
  contrastThreshold: number
  /** Background noise events per pixel per second of simulated time. Default 0. */
  noiseHz: number
}

export interface NeuronConfig {
  /** Number of neurons. Default 32. */
  count: number
  /** Membrane time constant tau, in milliseconds. Default 20. */
  tauMs: number
  /** Firing threshold for the membrane potential. Default 1. */
  threshold: number
  /** Time a neuron stays silent (held at 0) after a spike, in milliseconds. Default 3. */
  refractoryMs: number
}

export interface DecoderConfig {
  /** Time constant of each neuron's spike trace, in milliseconds. Default 60. */
  traceTauMs: number
  /** Below this summed trace the decoder reports null (not enough recent spikes to say). Default 0.05. */
  minActivity: number
}

export interface AccountingConfig {
  /** Frame rate of the clocked processor we compare against, in hertz. Default 1000. */
  clockHz: number
  /** Length of the sliding window for per-second rates, in milliseconds. Default 1000. */
  windowMs: number
}

/** Every setting, after defaults are applied. */
export interface SimConfig {
  /** Seed for the noise generator. Default 12345. */
  seed: number
  /** Simulation step, in milliseconds. Default 1. */
  dtMs: number
  /** How much spike and membrane history to keep for drawing, in milliseconds. Default 600. */
  historyMs: number
  sensor: SensorConfig
  neurons: NeuronConfig
  receptiveFields: ReceptiveFieldConfig
  decoder: DecoderConfig
  accounting: AccountingConfig
}

/** What `createSim` accepts: any subset of the settings, plus an optional scene. */
export interface SimOptions {
  seed?: number
  dtMs?: number
  historyMs?: number
  sensor?: Partial<SensorConfig>
  neurons?: Partial<NeuronConfig>
  receptiveFields?: Partial<ReceptiveFieldConfig>
  decoder?: Partial<DecoderConfig>
  accounting?: Partial<AccountingConfig>
  /** What the sensor looks at. Default: `createSpotScene` sized to the sensor. */
  scene?: Scene
}

export interface Spike {
  /** Simulated time at the end of the step in which the neuron fired, in milliseconds. */
  readonly timeMs: number
  readonly neuron: number
}

/** Running totals since the start (or the last reset). All exact integers. */
export interface OperationTotals {
  /** Every sensor event, signal and noise. */
  events: number
  onEvents: number
  offEvents: number
  /** Events caused by sensor noise rather than a brightness change (also counted in onEvents/offEvents). */
  noiseEvents: number
  spikes: number
  /** Synaptic additions done by the event-driven network: events x neuron count. */
  eventDrivenOps: number
  /** Frames a clocked processor would have read at `clockHz` in the same simulated time. */
  clockFrames: number
  /** Multiply-accumulates for those frames: frames x pixels x neurons. */
  clockedOps: number
}

/** Rates over the sliding window, per second of simulated time. */
export interface Rates {
  eventsPerS: number
  spikesPerS: number
  eventDrivenOpsPerS: number
  clockedOpsPerS: number
  /** clockedOpsPerS / eventDrivenOpsPerS; Infinity when there were no events. */
  savingRatio: number
  /** Root-mean-square decoding error in pixels along the tuned axis, or null with no decodable steps or no target. */
  rmsErrorPx: number | null
  /** Simulated milliseconds the window currently covers (less than windowMs just after a start or reset). */
  windowMs: number
}

/** Read-only views of the live state. The arrays are the simulator's own buffers: read them, don't write them. */
export interface SimState {
  readonly timeMs: number
  readonly steps: number
  /** True position of the tracked object, or null. */
  readonly target: Point | null
  /** Decoded position along the tuned axis, in pixels, or null when the network is too quiet to say. */
  readonly decoded: number | null
  readonly sensor: {
    readonly width: number
    readonly height: number
    /** Log brightness each pixel last reported, row-major (index y * width + x). */
    readonly reference: Float64Array
    /** Polarity of each pixel's most recent event: 1 ON, -1 OFF, 0 never fired. */
    readonly lastPolarity: Int8Array
    /** Time of each pixel's most recent event, -Infinity if never. */
    readonly lastEventMs: Float64Array
    /** Events in the most recent step. */
    readonly eventsLastStep: number
  }
  readonly neurons: {
    readonly count: number
    /** Membrane potential v of each neuron. */
    readonly potential: Float64Array
    /** Refractory time left, in milliseconds. */
    readonly refractoryLeftMs: Float64Array
    /** Decoder trace of each neuron. */
    readonly trace: Float64Array
    /** Preferred position of each neuron along the tuned axis. */
    readonly preferred: Float64Array
    /** Summed synaptic input each neuron received in the most recent step. */
    readonly inputLastStep: Float64Array
  }
  /** Spikes within the last historyMs, oldest first. */
  readonly spikes: readonly Spike[]
  readonly totals: Readonly<OperationTotals>
}

export interface StepResult {
  /** Whole steps taken (time left over is carried into the next call). */
  steps: number
  events: number
  spikes: number
}

export interface Sim {
  /** The settings in use, defaults filled in. */
  readonly config: Readonly<SimConfig>
  readonly state: SimState
  /** Advance by `ms` of simulated time, in steps of dtMs. A remainder smaller than one step carries over. */
  step(ms: number): StepResult
  /** Per-second rates over the sliding window. */
  rates(): Rates
  /** Membrane potential history of one neuron, oldest first, one sample per step, up to historyMs long. */
  membrane(neuron: number): Float64Array
  /** Change the sensor noise rate (events per pixel per second) from the next step on. */
  setNoiseHz(hz: number): void
  /** Look at a different scene. The sensor re-adapts to it silently, as if it had been watching it all along. */
  setScene(scene: Scene): void
  readonly scene: Scene
  /** Back to time 0: potentials, traces, history and counts cleared, random generator re-seeded. */
  reset(): void
}

function positive(name: string, v: number): number {
  if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`${name} must be a finite number greater than 0, got ${v}`)
  return v
}
function nonNegative(name: string, v: number): number {
  if (!(Number.isFinite(v) && v >= 0)) throw new RangeError(`${name} must be a finite number of at least 0, got ${v}`)
  return v
}
function wholeNumber(name: string, v: number): number {
  if (!(Number.isInteger(v) && v > 0)) throw new RangeError(`${name} must be a whole number greater than 0, got ${v}`)
  return v
}

/** Fill in defaults and validate. Exported so the renderer and tests can see the resolved values. */
export function resolveConfig(options: SimOptions = {}): SimConfig {
  const sensor: SensorConfig = { width: 24, height: 16, contrastThreshold: 0.22, noiseHz: 0, ...options.sensor }
  const neurons: NeuronConfig = { count: 32, tauMs: 20, threshold: 1, refractoryMs: 3, ...options.neurons }
  const receptiveFields: ReceptiveFieldConfig = { axis: "x", sigma: 1, gain: 0.16, ...options.receptiveFields }
  const decoder: DecoderConfig = { traceTauMs: 60, minActivity: 0.05, ...options.decoder }
  const accounting: AccountingConfig = { clockHz: 1000, windowMs: 1000, ...options.accounting }
  const config: SimConfig = {
    seed: options.seed ?? 12345,
    dtMs: options.dtMs ?? 1,
    historyMs: options.historyMs ?? 600,
    sensor,
    neurons,
    receptiveFields,
    decoder,
    accounting,
  }
  positive("dtMs", config.dtMs)
  positive("historyMs", config.historyMs)
  if (!Number.isFinite(config.seed)) throw new RangeError(`seed must be a finite number, got ${config.seed}`)
  wholeNumber("sensor.width", sensor.width)
  wholeNumber("sensor.height", sensor.height)
  positive("sensor.contrastThreshold", sensor.contrastThreshold)
  nonNegative("sensor.noiseHz", sensor.noiseHz)
  wholeNumber("neurons.count", neurons.count)
  positive("neurons.tauMs", neurons.tauMs)
  positive("neurons.threshold", neurons.threshold)
  nonNegative("neurons.refractoryMs", neurons.refractoryMs)
  if (receptiveFields.axis !== "x" && receptiveFields.axis !== "y") throw new RangeError(`receptiveFields.axis must be "x" or "y"`)
  positive("receptiveFields.sigma", receptiveFields.sigma)
  nonNegative("receptiveFields.gain", receptiveFields.gain)
  if (receptiveFields.preferred && receptiveFields.preferred.length !== neurons.count) {
    throw new RangeError(`receptiveFields.preferred has ${receptiveFields.preferred.length} entries; expected one per neuron (${neurons.count})`)
  }
  positive("decoder.traceTauMs", decoder.traceTauMs)
  nonNegative("decoder.minActivity", decoder.minActivity)
  positive("accounting.clockHz", accounting.clockHz)
  positive("accounting.windowMs", accounting.windowMs)
  return config
}

/** Build a simulator. Nothing runs until you call `step`. */
export function createSim(options: SimOptions = {}): Sim {
  const config = resolveConfig(options)
  const { dtMs: dt } = config
  const W = config.sensor.width
  const H = config.sensor.height
  const NPIX = W * H
  const NN = config.neurons.count
  const C = config.sensor.contrastThreshold
  const { threshold, refractoryMs } = config.neurons
  const decay = Math.exp(-dt / config.neurons.tauMs)
  const traceDecay = Math.exp(-dt / config.decoder.traceTauMs)
  const historySteps = Math.max(1, Math.round(config.historyMs / dt))
  const windowSteps = Math.max(1, Math.round(config.accounting.windowMs / dt))
  const opsPerFrame = NPIX * NN

  const extent = config.receptiveFields.axis === "x" ? W : H
  const preferred = config.receptiveFields.preferred ? Float64Array.from(config.receptiveFields.preferred) : evenlySpaced(NN, extent)
  const weights = buildWeights(W, H, preferred, config.receptiveFields)

  let scene: Scene = options.scene ?? createSpotScene({ width: W, height: H })
  let noiseHz = config.sensor.noiseHz
  let rand = createRandom(config.seed)

  // live state
  const reference = new Float64Array(NPIX)
  const lastPolarity = new Int8Array(NPIX)
  const lastEventMs = new Float64Array(NPIX)
  const potential = new Float64Array(NN)
  const refractoryLeftMs = new Float64Array(NN)
  const trace = new Float64Array(NN)
  const input = new Float64Array(NN)
  const membraneRing = new Float64Array(historySteps * NN)
  const winEvents = new Float64Array(windowSteps)
  const winSpikes = new Float64Array(windowSteps)
  const winErr = new Float64Array(windowSteps) // NaN where nothing was decodable
  let spikes: Spike[] = []
  let steps = 0
  let carry = 0
  let eventsLastStep = 0
  let decoded: number | null = null
  const totals: OperationTotals = { events: 0, onEvents: 0, offEvents: 0, noiseEvents: 0, spikes: 0, eventDrivenOps: 0, clockFrames: 0, clockedOps: 0 }

  const logBrightness = (i: number) => {
    const b = scene.brightness((i % W) + 0.5, Math.floor(i / W) + 0.5)
    if (!(b > 0)) throw new RangeError(`scene brightness must be greater than 0, got ${b} at pixel ${i % W},${Math.floor(i / W)}`)
    return Math.log(b)
  }
  const adapt = () => {
    for (let i = 0; i < NPIX; i++) reference[i] = logBrightness(i)
  }

  const reset = () => {
    rand = createRandom(config.seed)
    lastPolarity.fill(0)
    lastEventMs.fill(-Infinity)
    potential.fill(0)
    refractoryLeftMs.fill(0)
    trace.fill(0)
    input.fill(0)
    membraneRing.fill(0)
    winEvents.fill(0)
    winSpikes.fill(0)
    winErr.fill(Number.NaN)
    spikes = []
    steps = 0
    carry = 0
    eventsLastStep = 0
    decoded = null
    for (const k of Object.keys(totals) as (keyof OperationTotals)[]) totals[k] = 0
    adapt()
  }
  reset()

  const stepOnce = (): { events: number; spikes: number } => {
    scene.advance(dt)
    const now = (steps + 1) * dt
    const noiseP = (noiseHz * dt) / 1000

    // 2. sensor
    input.fill(0)
    let events = 0
    for (let i = 0; i < NPIX; i++) {
      const d = logBrightness(i) - reference[i]!
      let polarity = 0
      if (d > C) polarity = 1
      else if (d < -C) polarity = -1
      if (polarity !== 0) {
        reference[i]! += polarity * C
      } else if (noiseP > 0 && rand() < noiseP) {
        polarity = rand() < 0.5 ? 1 : -1
        totals.noiseEvents++
      }
      if (polarity === 0) continue
      events++
      if (polarity > 0) totals.onEvents++
      else totals.offEvents++
      lastPolarity[i] = polarity
      lastEventMs[i] = now
      const row = i * NN
      for (let n = 0; n < NN; n++) input[n]! += weights[row + n]!
    }
    totals.events += events
    totals.eventDrivenOps += events * NN

    // 3. neurons
    let fired = 0
    for (let n = 0; n < NN; n++) {
      trace[n]! *= traceDecay
      if (refractoryLeftMs[n]! > 0) {
        refractoryLeftMs[n] = Math.max(0, refractoryLeftMs[n]! - dt)
        potential[n] = 0
        continue
      }
      const v = potential[n]! * decay + input[n]!
      if (v >= threshold) {
        potential[n] = 0
        refractoryLeftMs[n] = refractoryMs
        trace[n]! += 1
        spikes.push({ timeMs: now, neuron: n })
        fired++
      } else {
        potential[n] = v
      }
    }
    totals.spikes += fired
    membraneRing.set(potential, (steps % historySteps) * NN)
    while (spikes.length > 0 && spikes[0]!.timeMs <= now - config.historyMs) spikes.shift()

    // 4. decoder
    let sum = 0
    let weight = 0
    for (let n = 0; n < NN; n++) {
      sum += trace[n]! * preferred[n]!
      weight += trace[n]!
    }
    decoded = weight > config.decoder.minActivity ? sum / weight : null

    // 5. accounting
    const target = scene.target()
    const truth = target ? (config.receptiveFields.axis === "x" ? target.x : target.y) : null
    const slot = steps % windowSteps
    winEvents[slot] = events
    winSpikes[slot] = fired
    winErr[slot] = decoded !== null && truth !== null ? decoded - truth : Number.NaN
    steps++
    totals.clockFrames = Math.floor((steps * dt * config.accounting.clockHz) / 1000 + 1e-9)
    totals.clockedOps = totals.clockFrames * opsPerFrame
    eventsLastStep = events
    return { events, spikes: fired }
  }

  const state: SimState = {
    get timeMs() {
      return steps * dt
    },
    get steps() {
      return steps
    },
    get target() {
      return scene.target()
    },
    get decoded() {
      return decoded
    },
    sensor: {
      width: W,
      height: H,
      reference,
      lastPolarity,
      lastEventMs,
      get eventsLastStep() {
        return eventsLastStep
      },
    },
    neurons: { count: NN, potential, refractoryLeftMs, trace, preferred, inputLastStep: input },
    get spikes() {
      return spikes
    },
    totals,
  }

  return {
    config,
    state,
    get scene() {
      return scene
    },
    step(ms) {
      nonNegative("step(ms)", ms)
      carry += ms
      const result: StepResult = { steps: 0, events: 0, spikes: 0 }
      // a tiny tolerance so that, e.g., ten steps of 0.1 ms add up to one 1 ms step
      while (carry >= dt - 1e-9) {
        const r = stepOnce()
        result.steps++
        result.events += r.events
        result.spikes += r.spikes
        carry -= dt
      }
      if (carry < 0) carry = 0
      return result
    },
    rates() {
      const filled = Math.min(steps, windowSteps)
      const spanMs = filled * dt
      let ev = 0
      let sp = 0
      let sq = 0
      let k = 0
      for (let i = 0; i < filled; i++) {
        ev += winEvents[i]!
        sp += winSpikes[i]!
        const e = winErr[i]!
        if (!Number.isNaN(e)) {
          sq += e * e
          k++
        }
      }
      const perS = spanMs > 0 ? 1000 / spanMs : 0
      const eventsPerS = ev * perS
      const eventDrivenOpsPerS = eventsPerS * NN
      const clockedOpsPerS = config.accounting.clockHz * opsPerFrame
      return {
        eventsPerS,
        spikesPerS: sp * perS,
        eventDrivenOpsPerS,
        clockedOpsPerS,
        savingRatio: eventDrivenOpsPerS > 0 ? clockedOpsPerS / eventDrivenOpsPerS : Infinity,
        rmsErrorPx: k > 0 ? Math.sqrt(sq / k) : null,
        windowMs: spanMs,
      }
    },
    membrane(neuron) {
      if (!(Number.isInteger(neuron) && neuron >= 0 && neuron < NN)) throw new RangeError(`neuron must be 0 to ${NN - 1}, got ${neuron}`)
      const len = Math.min(steps, historySteps)
      const out = new Float64Array(len)
      const first = steps - len
      for (let i = 0; i < len; i++) out[i] = membraneRing[((first + i) % historySteps) * NN + neuron]!
      return out
    },
    setNoiseHz(hz) {
      noiseHz = nonNegative("noiseHz", hz)
    },
    setScene(next) {
      scene = next
      adapt()
    },
    reset,
  }
}
