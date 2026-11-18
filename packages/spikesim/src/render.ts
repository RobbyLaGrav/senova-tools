// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

// Canvas drawing for the three panels: the event camera, the spike raster and one neuron's membrane potential.
// Each draw function takes a 2D context and a size in device pixels, so it works on any canvas (or a test stub).
// createRenderer wraps them for real <canvas> elements, keeping each canvas sharp at the screen's pixel ratio.

import type { Sim } from "./engine.ts"
import { DEFAULT_THEME, type Theme } from "./theme.ts"

/** The parts of CanvasRenderingContext2D the renderer uses. A real context satisfies it. */
export type Context2D = Pick<
  CanvasRenderingContext2D,
  "fillStyle" | "strokeStyle" | "globalAlpha" | "lineWidth" | "lineJoin" | "fillRect" | "beginPath" | "moveTo" | "lineTo" | "arc" | "stroke" | "setLineDash"
>

/** Drawing area in device pixels, and the device pixel ratio used to scale line widths. */
export interface Size {
  width: number
  height: number
  dpr: number
}

export interface SensorDrawOptions {
  /** How long an event's colour takes to fade to about a third, in simulated milliseconds. Default 30. */
  flashMs?: number
}

/** Pixel cells shaded by brightness, recent events in the ON/OFF colours, a ring on the target, a line at the estimate. */
export function drawSensor(ctx: Context2D, sim: Sim, theme: Readonly<Theme>, size: Size, options: SensorDrawOptions = {}): void {
  const { width: w, height: h, dpr } = size
  const { width: GW, height: GH, lastPolarity, lastEventMs } = sim.state.sensor
  const flashMs = options.flashMs ?? 30
  const now = sim.state.timeMs
  ctx.globalAlpha = 1
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, w, h)
  const cell = Math.min(w / GW, h / GH)
  const ox = (w - cell * GW) / 2
  const oy = (h - cell * GH) / 2
  const gap = cell > 6 ? 1 : 0
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x
      const px = ox + x * cell + gap
      const py = oy + y * cell + gap
      const b = Math.min(1, Math.max(0, sim.scene.brightness(x + 0.5, y + 0.5)))
      // the cell, then the scene's brightness as a wash of the foreground colour (visible on light and dark themes)
      ctx.globalAlpha = 1
      ctx.fillStyle = theme.surface
      ctx.fillRect(px, py, cell - 2 * gap, cell - 2 * gap)
      ctx.globalAlpha = 0.4 * b
      ctx.fillStyle = theme.foreground
      ctx.fillRect(px, py, cell - 2 * gap, cell - 2 * gap)
      const pol = lastPolarity[i]!
      if (pol !== 0) {
        const fade = Math.exp(-(now - lastEventMs[i]!) / flashMs)
        if (fade > 0.02) {
          ctx.globalAlpha = fade
          ctx.fillStyle = pol > 0 ? theme.on : theme.off
          ctx.fillRect(px, py, cell - 2 * gap, cell - 2 * gap)
        }
      }
    }
  }
  ctx.globalAlpha = 1
  const target = sim.state.target
  if (target) {
    ctx.strokeStyle = theme.muted
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()
    ctx.arc(ox + target.x * cell, oy + target.y * cell, cell * 1.6, 0, Math.PI * 2)
    ctx.stroke()
  }
  const decoded = sim.state.decoded
  if (decoded !== null) {
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 2 * dpr
    ctx.beginPath()
    if (sim.config.receptiveFields.axis === "x") {
      ctx.moveTo(ox + decoded * cell, oy - 2 * dpr)
      ctx.lineTo(ox + decoded * cell, oy + GH * cell + 2 * dpr)
    } else {
      ctx.moveTo(ox - 2 * dpr, oy + decoded * cell)
      ctx.lineTo(ox + GW * cell + 2 * dpr, oy + decoded * cell)
    }
    ctx.stroke()
  }
}

/** One row per neuron, time running right to left over the last historyMs; the selected row is highlighted. */
export function drawRaster(ctx: Context2D, sim: Sim, theme: Readonly<Theme>, size: Size, selected: number): void {
  const { width: w, height: h, dpr } = size
  const NN = sim.state.neurons.count
  const span = sim.config.historyMs
  const now = sim.state.timeMs
  ctx.globalAlpha = 1
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, w, h)
  const rowH = h / NN
  ctx.fillStyle = theme.surface
  ctx.fillRect(0, selected * rowH, w, rowH)
  const sx = w / span
  for (const s of sim.state.spikes) {
    const age = now - s.timeMs
    ctx.fillStyle = s.neuron === selected ? theme.accent : theme.foreground
    ctx.globalAlpha = 0.35 + 0.65 * (1 - age / span)
    ctx.fillRect(w - age * sx - 0.75 * dpr, s.neuron * rowH + rowH * 0.22, 1.5 * dpr, rowH * 0.56)
  }
  ctx.globalAlpha = 1
}

/** Which raster row a vertical position falls in, for picking a neuron by pointer. */
export function neuronAtY(y: number, height: number, count: number): number {
  if (!(height > 0)) return 0
  return Math.max(0, Math.min(count - 1, Math.floor((y / height) * count)))
}

/** The selected neuron's potential over the last historyMs, the threshold dashed, each spike as a stroke to the top. */
export function drawMembrane(ctx: Context2D, sim: Sim, theme: Readonly<Theme>, size: Size, selected: number): void {
  const { width: w, height: h, dpr } = size
  const threshold = sim.config.neurons.threshold
  const span = sim.config.historyMs
  const dt = sim.config.dtMs
  const now = sim.state.timeMs
  const top = threshold * 1.6
  const pad = 6 * dpr
  const y = (v: number) => h - pad - (Math.min(Math.max(v, 0), top) / top) * (h - 2 * pad)
  const sx = w / span
  ctx.globalAlpha = 1
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = theme.muted
  ctx.setLineDash([5 * dpr, 4 * dpr])
  ctx.lineWidth = dpr
  ctx.beginPath()
  ctx.moveTo(0, y(threshold))
  ctx.lineTo(w, y(threshold))
  ctx.stroke()
  ctx.setLineDash([])

  const trace = sim.membrane(selected)
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = 1.6 * dpr
  ctx.lineJoin = "round"
  ctx.beginPath()
  for (let i = 0; i < trace.length; i++) {
    const x = w - (trace.length - 1 - i) * dt * sx
    if (i === 0) ctx.moveTo(x, y(trace[i]!))
    else ctx.lineTo(x, y(trace[i]!))
  }
  ctx.stroke()

  ctx.beginPath()
  for (const s of sim.state.spikes) {
    if (s.neuron !== selected) continue
    const x = w - (now - s.timeMs) * sx
    ctx.moveTo(x, y(threshold))
    ctx.lineTo(x, y(top))
  }
  ctx.stroke()
}

/** Size a canvas's backing store to its CSS box at the device pixel ratio (capped at 2), and return its context. */
export function fitCanvas(canvas: HTMLCanvasElement, maxDpr = 2): { ctx: CanvasRenderingContext2D; size: Size } | null {
  const view = canvas.ownerDocument.defaultView
  const dpr = Math.min(maxDpr, view?.devicePixelRatio || 1)
  const r = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(r.width * dpr))
  const height = Math.max(1, Math.round(r.height * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext("2d")
  return ctx ? { ctx, size: { width, height, dpr } } : null
}

export interface RendererCanvases {
  sensor?: HTMLCanvasElement | null
  raster?: HTMLCanvasElement | null
  membrane?: HTMLCanvasElement | null
}

export interface Renderer {
  /** Draw every panel that has a canvas. */
  draw(sim: Sim): void
  /** Neuron shown in the membrane panel and highlighted in the raster. */
  selected: number
  theme: Theme
}

/** Draw a simulator onto up to three canvases. Leave a canvas out to skip that panel. */
export function createRenderer(canvases: RendererCanvases, options: { theme?: Theme; selected?: number; sensor?: SensorDrawOptions } = {}): Renderer {
  const renderer: Renderer = {
    selected: options.selected ?? 0,
    theme: options.theme ?? { ...DEFAULT_THEME },
    draw(sim) {
      const sel = Math.max(0, Math.min(sim.state.neurons.count - 1, renderer.selected))
      const s = canvases.sensor && fitCanvas(canvases.sensor)
      if (s) drawSensor(s.ctx, sim, renderer.theme, s.size, options.sensor)
      const r = canvases.raster && fitCanvas(canvases.raster)
      if (r) drawRaster(r.ctx, sim, renderer.theme, r.size, sel)
      const m = canvases.membrane && fitCanvas(canvases.membrane)
      if (m) drawMembrane(m.ctx, sim, renderer.theme, m.size, sel)
    },
  }
  return renderer
}
