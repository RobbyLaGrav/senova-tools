# Spikesim

A browser simulation of event-driven (neuromorphic) sensing and computing: an event camera feeds leaky integrate-and-fire neurons, a population-vector decoder reads out where a moving spot is, and live counters compare the work done with a clocked processor.

**For:** teaching, demos and quick experiments with neuromorphic ideas. **Status:** in progress.

It is the model behind the live demo on [senovasys.com/research/neuromorphic](https://senovasys.com/research/neuromorphic), split into three layers you can use on their own:

| Layer | Import | Needs |
| --- | --- | --- |
| Headless engine: `createSim`, `step(ms)`, typed state | `@senova/spikesim` | Nothing (Node or browser) |
| Canvas renderer and animation loop | `@senova/spikesim` | A browser |
| `<SpikeSim />` React component | `@senova/spikesim/react` | React 18 or newer |

## Install

```sh
npm install @senova/spikesim
```

## Two-minute example

```ts
import { createSim, createSpotScene, formatRate, formatRatio } from "@senova/spikesim"

const scene = createSpotScene({ speedHz: 0.35 }) // a bright spot drifting across a 24 x 16 event camera
const sim = createSim({ seed: 1, sensor: { noiseHz: 1.5 }, scene })

sim.step(2000) // two seconds of simulated time, in 1 ms steps

const r = sim.rates() // per second, over the last second
console.log(formatRate(r.eventsPerS), "events/s")
console.log(formatRatio(r.savingRatio), "less work than a clocked processor")
console.log(r.rmsErrorPx, "px rms decoding error")

// Hold the spot still: the sensor goes quiet and event-driven work stops; the clocked count doesn't change.
scene.speedHz = 0
sim.setNoiseHz(0)
sim.step(1000)
console.log(sim.rates().eventsPerS) // 0
```

Run it from this folder with `npm run example`. With these settings it prints about 2.5 k events/s, 151× less work and 1.4 px rms error (seed 1, counted by this model; see [Limits](#limits)).

### In the browser, without a framework

```ts
import { createRenderer, createSim, readTheme, startLoop } from "@senova/spikesim"

const sim = createSim()
const renderer = createRenderer({ sensor: sensorCanvas, raster: rasterCanvas, membrane: membraneCanvas }, { theme: readTheme(container) })
const loop = startLoop({ sim, element: container, draw: (s) => renderer.draw(s) }) // pauses off screen
```

`npm run example:browser` serves [examples/index.html](examples/index.html), a complete page with controls and counters, at http://127.0.0.1:5178. No build step: the small local server strips the TypeScript types as it serves `src/`.

### In React

```tsx
import { SpikeSim } from "@senova/spikesim/react"

export default function Page() {
  return <SpikeSim options={{ neurons: { count: 32, tauMs: 20 } }} timeScale={0.25} />
}
```

The component brings its own controls (spot speed, noise, play/pause), the three panels, the counters and a small stylesheet. It starts paused for readers who prefer reduced motion and stops all work while it is off screen. In a Next.js App Router project, render it from a client component (`"use client"`).

## The model

### 1. Sensor: an event camera

Each pixel remembers the log brightness it last reported, `ref`. Every step it compares the current log brightness with it and reports an event only when the difference passes the contrast threshold `C`:

```
|log I(x, y, t) - ref(x, y)| > C
```

Up gives an ON event, down an OFF event, and the reference moves one threshold towards the new level (`ref += ±C`). A large change therefore produces a burst of events, one per step, until the reference catches up. A pixel that sees no change says nothing. Optionally, each pixel also fires random noise events at `noiseHz` (a real sensor's background activity); noise does not move the reference.

### 2. Network: leaky integrate-and-fire neurons

Neuron `n` has membrane potential `v_n`, which leaks towards 0 with time constant `tau` and is kicked by incoming events:

```
tau dv_n/dt = -v_n + tau Σ_k w_n(p_k) δ(t - t_k)
```

Each event `k`, at pixel `p_k` and time `t_k`, adds its weight `w_n(p_k)` to the potential at once. Integrated exactly over a step `dt`, this is the update the engine runs:

```
v_n[t + dt] = v_n[t] · exp(-dt / tau) + Σ_events in the step w_n(p)
```

When `v_n` reaches the threshold `θ` the neuron spikes, `v_n` resets to 0, and it ignores input for the refractory period `t_ref`.

**Receptive fields.** Each neuron prefers a position `c_n` along one axis (x by default, evenly spaced) and listens to pixel columns through a Gaussian:

```
w_n(x, y) = gain · exp(-((x + 0.5) - c_n)² / (2 σ²))
```

Pass `receptiveFields.weight` to use any other weighting.

### 3. Decoder: a population vector

Each spike adds 1 to its neuron's trace `s_n`, which decays with `traceTauMs`. The estimate is the trace-weighted mean of the preferred positions:

```
x̂ = Σ_n s_n c_n / Σ_n s_n
```

reported as `null` while `Σ s_n` is below `minActivity` (too few recent spikes to say).

### 4. Accounting

| Counter | Counts |
| --- | --- |
| Event-driven synaptic operations | events × neurons: each event is fanned out to every neuron with one addition |
| Clocked multiply-accumulates | frames × pixels × neurons, at `clockHz` (default 1 kHz), moving or not |
| Saving ratio | clocked / event-driven over the sliding window (∞ when there were no events) |

Totals are exact integers; rates are averaged over a sliding window (default 1 s of simulated time).

## API

Everything below is exported from `@senova/spikesim` unless marked otherwise. Times are milliseconds of simulated time; positions are in pixels (pixel `(x, y)` covers `[x, x+1) × [y, y+1)`).

### `createSim(options?: SimOptions): Sim`

Builds a simulator. Every setting is optional:

| Setting | Default | Meaning |
| --- | --- | --- |
| `seed` | 12345 | Seeds the noise generator. Same seed and settings, same run. |
| `dtMs` | 1 | Simulation step |
| `historyMs` | 600 | Spike and membrane history kept for drawing |
| `sensor.width`, `sensor.height` | 24, 16 | Pixels |
| `sensor.contrastThreshold` | 0.22 | `C`, in natural-log units |
| `sensor.noiseHz` | 0 | Noise events per pixel per second |
| `neurons.count` | 32 | Neurons |
| `neurons.tauMs` | 20 | Membrane time constant `tau` |
| `neurons.threshold` | 1 | Firing threshold `θ` |
| `neurons.refractoryMs` | 3 | Refractory period |
| `receptiveFields.axis` | `"x"` | Axis the neurons are tuned to and the decoder reports |
| `receptiveFields.sigma` | 1 | Tuning width `σ` |
| `receptiveFields.gain` | 0.16 | Peak weight |
| `receptiveFields.preferred` | evenly spaced | One preferred position per neuron |
| `receptiveFields.weight` | Gaussian | `(neuron, x, y) => weight` override |
| `decoder.traceTauMs` | 60 | Trace time constant |
| `decoder.minActivity` | 0.05 | Summed trace below which `decoded` is `null` |
| `accounting.clockHz` | 1000 | Frame rate of the clocked comparison |
| `accounting.windowMs` | 1000 | Window for `rates()` |
| `scene` | `createSpotScene()` sized to the sensor | What the camera looks at |

Invalid settings throw a `RangeError` that names the setting.

### `Sim`

| Member | Description |
| --- | --- |
| `step(ms): StepResult` | Advance by `ms` in whole steps; a remainder carries into the next call. Returns `{ steps, events, spikes }`. |
| `state: SimState` | Live, typed, read-only views: `timeMs`, `steps`, `target`, `decoded`, `sensor` (`reference`, `lastPolarity`, `lastEventMs`, `eventsLastStep`), `neurons` (`potential`, `refractoryLeftMs`, `trace`, `preferred`, `inputLastStep`), `spikes` (within `historyMs`) and `totals` (`events`, `onEvents`, `offEvents`, `noiseEvents`, `spikes`, `eventDrivenOps`, `clockFrames`, `clockedOps`). The typed arrays are the engine's own buffers: read them, don't write them. |
| `rates(): Rates` | Per second: `eventsPerS`, `spikesPerS`, `eventDrivenOpsPerS`, `clockedOpsPerS`, `savingRatio`, `rmsErrorPx` (or `null`), and the `windowMs` covered. |
| `membrane(neuron): Float64Array` | That neuron's potential, one sample per step, oldest first. |
| `setNoiseHz(hz)` | Change the noise rate from the next step. |
| `setScene(scene)` / `scene` | Swap or read the scene. The sensor re-adapts silently to a new scene. |
| `reset()` | Back to time 0 with everything cleared and the generator re-seeded. The scene keeps its own clock. |
| `config` | The resolved settings. |

`resolveConfig(options)` returns the settings with defaults filled in, without building a simulator.

### Scenes

`createSpotScene(options?): SpotScene` is a Gaussian spot (`radius` 1.7, peak 1 on `background` 0.08) moving on a smooth path around the centre. Its `speedHz` (default 0.35) can be changed at any time without the spot jumping.

Write your own by implementing `Scene`: `advance(dtMs)`, `brightness(x, y)` (must be greater than 0) and `target()` (the true position, or `null`).

### Drawing (browser)

| Export | Description |
| --- | --- |
| `createRenderer(canvases, { theme?, selected?, sensor? }): Renderer` | Draws up to three canvases (`sensor`, `raster`, `membrane`) at the device pixel ratio. Set `renderer.selected` and `renderer.theme` at any time. |
| `drawSensor`, `drawRaster`, `drawMembrane` | The panels on their own, for any 2D context and size. |
| `fitCanvas(canvas)` | Sizes a canvas to its CSS box at the pixel ratio (capped at 2). |
| `neuronAtY(y, height, count)` | The raster row under a pointer. |
| `startLoop({ sim, draw, timeScale?, element?, playing? }): Loop` | A `requestAnimationFrame` loop. Simulated time runs at `timeScale` (default 0.25) of real time; nothing runs while `element` is off screen. `play()`, `pause()`, `setTimeScale()`, `destroy()`. |
| `readTheme(element): Theme`, `DEFAULT_THEME`, `THEME_VARIABLES` | Theme colours from CSS custom properties. |
| `formatRate(n)`, `formatRatio(n)` | `"12.4 k"`, `"151×"`. |
| `createRandom(seed)`, `buildWeights`, `evenlySpaced` | The building blocks the engine uses. |

### `@senova/spikesim/react`

`<SpikeSim />` props, all optional:

| Prop | Default | Description |
| --- | --- | --- |
| `options` | | Engine settings (`SimOptions` without `scene`), read once on mount |
| `timeScale` | 0.25 | Simulated ms per real ms |
| `speeds`, `noises` | Still/Slow/Fast, none/sensor/heavy | Choices offered, as `{ label, hz }` |
| `initialSpeed`, `initialNoise` | 1, 1 | Starting choice indexes |
| `autoPlay` | true unless reduced motion is preferred | Start playing |
| `unstyled` | false | Leave out the built-in stylesheet |
| `className`, `style` | | On the root element (`.spikesim`) |

Also exported: `SPIKESIM_CSS` (the built-in stylesheet), `DEFAULT_SPEEDS`, `DEFAULT_NOISES`.

## Theming

The canvases and the built-in styles read these CSS custom properties. Set them on the component or any ancestor; any CSS colour works, including `light-dark()` and `var()`.

| Property | Used for | Default |
| --- | --- | --- |
| `--spikesim-bg` | Canvas and panel background | `#ffffff` |
| `--spikesim-fg` | Text, scene brightness, unselected spikes | `#0b0b0c` |
| `--spikesim-muted` | Captions, true-position ring, threshold line | `#5c5d65` |
| `--spikesim-surface` | Pixel cells, selected raster row, selected buttons | `#ebebed` |
| `--spikesim-line` | Borders (styles only) | `#e4e4e7` |
| `--spikesim-on` | ON events | `#2747d6` |
| `--spikesim-off` | OFF events | `#0b0b0c` |
| `--spikesim-accent` | Decoded position, selected neuron, membrane trace | `#2747d6` |
| `--spikesim-font`, `--spikesim-radius` | Font family, corner radius (styles only) | inherit, `8px` |

A dark theme:

```css
@media (prefers-color-scheme: dark) {
  .spikesim {
    --spikesim-bg: #141416; --spikesim-fg: #f4f4f5; --spikesim-muted: #a1a1aa; --spikesim-surface: #2a2a2e;
    --spikesim-line: #2a2a2e; --spikesim-on: #7c93ff; --spikesim-off: #f4f4f5; --spikesim-accent: #7c93ff;
  }
}
```

The React component re-reads the colours when the page's `class`, `style` or `data-theme` attribute changes, or the system colour scheme does. Every built-in rule is wrapped in `:where()`, so any rule of yours overrides it.

## Limits

This is a **teaching model, not a chip model**.

- Operation counts are counts of this model's arithmetic, not measured energy or time on any hardware. A real neuromorphic chip has routing, memory access and static power that are not modelled; a real clocked pipeline would skip zero weights. The ratio shows the idea (work follows change, not frame rate), not a benchmark.
- The sensor is idealised: no per-pixel threshold mismatch, no pixel latency or refractory period, no bandwidth limit, and at most one event per pixel per step. Noise is uniform and independent.
- Neurons are point neurons with instantaneous (delta) synapses, one shared threshold and no learning. Weights are fixed.
- The decoder reads one axis. With the default settings it tracks the slow spot to about 1 to 2 px rms; the error grows with speed and noise (run on this engine for 5 s: about 2.8 px at 1.1 Hz, 3.5 px with heavy noise).
- Time is discrete (`dtMs`), and the canvas demo runs at a quarter of real time so single spikes are visible.

## Dependencies

None at runtime. React is an optional peer dependency, needed only for `@senova/spikesim/react`. Development only: `react`, `react-dom`, `@types/react`, `@types/react-dom` (all MIT).

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
