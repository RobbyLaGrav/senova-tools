// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

// <SpikeSim />: the full demo as one React component. Controls for motion, noise and play/pause, the three canvas
// panels, and live counters. Written with createElement rather than JSX so Node runs it (and its tests) directly.

import { createElement as h, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement } from "react"

import { createSim, resolveConfig, type SimOptions } from "./engine.ts"
import { formatRate, formatRatio } from "./format.ts"
import { startLoop, type Loop } from "./loop.ts"
import { createRenderer, neuronAtY } from "./render.ts"
import { createSpotScene } from "./scene.ts"
import { readTheme } from "./theme.ts"

export interface Choice {
  readonly label: string
  readonly hz: number
}

export const DEFAULT_SPEEDS: readonly Choice[] = [
  { label: "Still", hz: 0 },
  { label: "Slow", hz: 0.35 },
  { label: "Fast", hz: 1.1 },
]

export const DEFAULT_NOISES: readonly Choice[] = [
  { label: "No noise", hz: 0 },
  { label: "Sensor noise", hz: 1.5 },
  { label: "Heavy noise", hz: 6 },
]

export interface SpikeSimProps {
  /** Engine settings, read once when the component mounts. The scene is always the moving spot. */
  options?: Omit<SimOptions, "scene">
  /** Simulated milliseconds per real millisecond. Default 0.25. */
  timeScale?: number
  /** Spot speeds offered (cycles per second). Default Still / Slow / Fast. */
  speeds?: readonly Choice[]
  /** Noise levels offered (events per pixel per second). Default none / sensor / heavy. */
  noises?: readonly Choice[]
  /** Index into `speeds` to start with. Default 1. */
  initialSpeed?: number
  /** Index into `noises` to start with. Default 1. */
  initialNoise?: number
  /** Start playing. Default true, except for readers who ask for reduced motion. */
  autoPlay?: boolean
  /** Leave out the built-in stylesheet (SPIKESIM_CSS) and style the class names yourself. */
  unstyled?: boolean
  className?: string
  style?: CSSProperties
}

interface Counters {
  eventsPerS: number
  eventDrivenOpsPerS: number
  clockedOpsPerS: number
  savingRatio: number
  rmsErrorPx: number | null
}

/**
 * The built-in styles. Every rule sits inside :where(), so it has zero specificity and any rule of yours wins.
 * Colours and shape come from CSS custom properties (see the README's Theming section).
 */
export const SPIKESIM_CSS = `
:where(.spikesim){font:inherit;font-family:var(--spikesim-font,inherit);color:var(--spikesim-fg,#0b0b0c);display:grid;gap:12px}
:where(.spikesim-controls){display:flex;flex-wrap:wrap;gap:8px;align-items:center}
:where(.spikesim-group){display:inline-flex;border:1px solid var(--spikesim-line,#e4e4e7);border-radius:var(--spikesim-radius,8px);overflow:hidden}
:where(.spikesim button){font:inherit;font-size:.875em;color:inherit;background:var(--spikesim-bg,#fff);border:0;padding:6px 12px;cursor:pointer}
:where(.spikesim-group button+button){border-left:1px solid var(--spikesim-line,#e4e4e7)}
:where(.spikesim button[aria-checked="true"],.spikesim button[aria-pressed="true"]){background:var(--spikesim-surface,#ebebed);font-weight:600}
:where(.spikesim-play){border:1px solid var(--spikesim-line,#e4e4e7)!important;border-radius:var(--spikesim-radius,8px)}
:where(.spikesim button:focus-visible){outline:2px solid var(--spikesim-accent,#2747d6);outline-offset:-2px}
:where(.spikesim-panels){display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))}
:where(.spikesim-panel){margin:0;display:grid;gap:8px;align-content:start;background:var(--spikesim-bg,#fff);border:1px solid var(--spikesim-line,#e4e4e7);border-radius:var(--spikesim-radius,8px);padding:12px}
:where(.spikesim-panel figcaption){display:grid;gap:2px;font-size:.875em}
:where(.spikesim-panel figcaption span,.spikesim-label,.spikesim-note,.spikesim-counter span:last-child){color:var(--spikesim-muted,#5c5d65)}
:where(.spikesim canvas){display:block;width:100%}
:where(.spikesim-sensor){aspect-ratio:3/2}
:where(.spikesim-raster){height:180px;cursor:pointer;touch-action:none}
:where(.spikesim-membrane){height:72px}
:where(.spikesim-label){display:flex;justify-content:space-between;gap:8px;font-size:.8em}
:where(.spikesim-counters){display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
:where(.spikesim-counter){display:grid;gap:2px;font-size:.8em}
:where(.spikesim-counter span:first-child){font-size:1.6em;font-weight:600;font-variant-numeric:tabular-nums;color:var(--spikesim-fg,#0b0b0c)}
:where(.spikesim-counter.spikesim-highlight span:first-child){color:var(--spikesim-accent,#2747d6)}
:where(.spikesim-note){font-size:.8em;margin:0}
`

const pick = <T>(list: readonly T[], i: number): T | undefined => list[Math.max(0, Math.min(list.length - 1, i))]

/** The neuromorphic demo: an event camera feeding spiking neurons that track a moving spot. */
export function SpikeSim(props: SpikeSimProps): ReactElement {
  const speeds = props.speeds ?? DEFAULT_SPEEDS
  const noises = props.noises ?? DEFAULT_NOISES
  const root = useRef<HTMLDivElement>(null)
  const sensorCv = useRef<HTMLCanvasElement>(null)
  const rasterCv = useRef<HTMLCanvasElement>(null)
  const membraneCv = useRef<HTMLCanvasElement>(null)
  const loopRef = useRef<Loop | null>(null)
  const control = useRef({ speed: 0, noise: 0, selected: 0 })

  const [speed, setSpeed] = useState(props.initialSpeed ?? 1)
  const [noise, setNoise] = useState(props.initialNoise ?? 1)
  const [playing, setPlaying] = useState(props.autoPlay ?? true)
  const [neuronCount] = useState(() => props.options?.neurons?.count ?? 32)
  const [selected, setSelected] = useState(() => Math.floor(neuronCount / 2))
  const [counters, setCounters] = useState<Counters | null>(null)

  control.current = { speed: pick(speeds, speed)?.hz ?? 0, noise: pick(noises, noise)?.hz ?? 0, selected }

  // readers who prefer reduced motion start paused (unless autoPlay was set explicitly)
  useEffect(() => {
    if (props.autoPlay !== undefined) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPlaying(false)
  }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const { sensor } = resolveConfig(props.options)
    const scene = createSpotScene({ width: sensor.width, height: sensor.height, speedHz: control.current.speed })
    const sim = createSim({ ...props.options, scene, sensor: { ...sensor, noiseHz: control.current.noise } })
    const renderer = createRenderer({ sensor: sensorCv.current, raster: rasterCv.current, membrane: membraneCv.current }, { theme: readTheme(el) })

    const refreshTheme = () => (renderer.theme = readTheme(el))
    const mo = new MutationObserver(refreshTheme)
    mo.observe(el.ownerDocument.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] })
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)")
    mq?.addEventListener("change", refreshTheme)

    let lastCount = 0
    const loop = startLoop({
      sim,
      element: el,
      timeScale: props.timeScale ?? 0.25,
      playing: false,
      draw: () => {
        scene.speedHz = control.current.speed
        sim.setNoiseHz(control.current.noise)
        renderer.selected = control.current.selected
        renderer.draw(sim)
        const now = performance.now()
        if (now - lastCount > 220) {
          lastCount = now
          const r = sim.rates()
          setCounters({ eventsPerS: r.eventsPerS, eventDrivenOpsPerS: r.eventDrivenOpsPerS, clockedOpsPerS: r.clockedOpsPerS, savingRatio: r.savingRatio, rmsErrorPx: r.rmsErrorPx })
        }
      },
    })
    loopRef.current = loop
    return () => {
      loop.destroy()
      loopRef.current = null
      mo.disconnect()
      mq?.removeEventListener("change", refreshTheme)
    }
  }, [])

  useEffect(() => {
    if (playing) loopRef.current?.play()
    else loopRef.current?.pause()
  }, [playing])

  useEffect(() => {
    loopRef.current?.setTimeScale(props.timeScale ?? 0.25)
  }, [props.timeScale])

  const pickRow = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setSelected(neuronAtY(e.clientY - r.top, r.height, neuronCount))
  }

  const radioGroup = (label: string, choices: readonly Choice[], value: number, set: (i: number) => void) =>
    h(
      "div",
      { className: "spikesim-group", role: "radiogroup", "aria-label": label },
      choices.map((c, i) => h("button", { key: c.label, type: "button", role: "radio", "aria-checked": value === i, onClick: () => set(i) }, c.label)),
    )

  const counter = (value: string, label: string, highlight = false) =>
    h("div", { className: highlight ? "spikesim-counter spikesim-highlight" : "spikesim-counter" }, h("span", null, value), h("span", null, label))

  const c = counters
  return h(
    "div",
    { className: props.className ? `spikesim ${props.className}` : "spikesim", style: props.style, ref: root },
    props.unstyled ? null : h("style", null, SPIKESIM_CSS),
    h(
      "div",
      { className: "spikesim-controls" },
      radioGroup("Spot motion", speeds, speed, setSpeed),
      radioGroup("Sensor noise", noises, noise, setNoise),
      h("button", { type: "button", className: "spikesim-play", "aria-pressed": playing, onClick: () => setPlaying((p) => !p) }, playing ? "Pause" : "Play"),
    ),
    h(
      "div",
      { className: "spikesim-panels" },
      h(
        "figure",
        { className: "spikesim-panel" },
        h("figcaption", null, h("b", null, "1 · Event camera"), h("span", null, "Pixels report only changes: ON and OFF events. Ring: the spot. Line: where the network thinks it is.")),
        h("canvas", { ref: sensorCv, className: "spikesim-sensor", role: "img", "aria-label": "Event camera pixels and decoded position" }),
      ),
      h(
        "figure",
        { className: "spikesim-panel" },
        h("figcaption", null, h("b", null, "2 · Spiking neurons"), h("span", null, `${neuronCount} neurons tuned to position. Tap a row to watch that neuron.`)),
        h("canvas", { ref: rasterCv, className: "spikesim-raster", role: "img", "aria-label": `Spike raster of ${neuronCount} neurons`, onPointerDown: pickRow }),
        h("div", { className: "spikesim-label" }, h("span", null, `Neuron ${selected + 1}: membrane potential`), h("span", null, "dashed: firing threshold")),
        h("canvas", { ref: membraneCv, className: "spikesim-membrane", role: "img", "aria-label": `Membrane potential of neuron ${selected + 1}` }),
      ),
    ),
    h(
      "div",
      { className: "spikesim-counters" },
      counter(c ? formatRate(c.eventsPerS) : "–", "events per second from the sensor"),
      counter(c ? formatRate(c.eventDrivenOpsPerS) : "–", "synaptic operations per second, event-driven"),
      counter(c ? formatRate(c.clockedOpsPerS) : "–", "multiply-accumulates per second, clocked"),
      counter(c ? formatRatio(c.savingRatio) : "–", "less work when only changes are processed", true),
      counter(c?.rmsErrorPx != null ? `${c.rmsErrorPx.toFixed(1)} px` : "–", "decoding error, rms over the last second"),
    ),
    h(
      "p",
      { className: "spikesim-note" },
      "A teaching model, not a chip model. Simulated time runs slower than real time so single spikes are visible; rates are per second of simulated time.",
    ),
  )
}
