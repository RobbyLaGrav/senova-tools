// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { createSim, DEFAULT_THEME, drawMembrane, drawRaster, drawSensor, neuronAtY, type Context2D } from "../src/index.ts"

/** A stand-in 2D context that records every call, so drawing can be tested without a browser. */
function recorder() {
  const calls: { name: string; args: unknown[]; fillStyle: unknown; globalAlpha: number }[] = []
  const ctx = { fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1, lineJoin: "miter" } as Record<string, unknown>
  for (const name of ["fillRect", "beginPath", "moveTo", "lineTo", "arc", "stroke", "setLineDash"]) {
    ctx[name] = (...args: unknown[]) => calls.push({ name, args, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha as number })
  }
  return { ctx: ctx as unknown as Context2D, calls }
}
const size = { width: 480, height: 320, dpr: 1 }

test("the sensor panel draws every pixel, and recent events in the ON colour", () => {
  const sim = createSim({ seed: 1 })
  sim.step(200)
  const { ctx, calls } = recorder()
  drawSensor(ctx, sim, DEFAULT_THEME, size)
  const rects = calls.filter((c) => c.name === "fillRect")
  assert.ok(rects.length >= 1 + 24 * 16)
  assert.ok(rects.some((c) => c.fillStyle === DEFAULT_THEME.on), "no ON event drawn")
  assert.ok(calls.some((c) => c.name === "arc"), "no target ring drawn")
})

test("the raster draws one mark per spike in the history", () => {
  const sim = createSim()
  sim.step(600)
  const { ctx, calls } = recorder()
  drawRaster(ctx, sim, DEFAULT_THEME, size, 16)
  const rects = calls.filter((c) => c.name === "fillRect")
  assert.equal(rects.length, 2 + sim.state.spikes.length) // background, selected row, spikes
  assert.ok(sim.state.spikes.length > 0)
})

test("the membrane panel draws the trace with one point per step", () => {
  const sim = createSim()
  sim.step(100)
  const { ctx, calls } = recorder()
  drawMembrane(ctx, sim, DEFAULT_THEME, size, 16)
  const points = calls.filter((c) => c.name === "moveTo" || c.name === "lineTo").length
  const spikeStrokes = sim.state.spikes.filter((s) => s.neuron === 16).length * 2
  assert.equal(points, 2 + 100 + spikeStrokes) // threshold line, trace, spike strokes
})

test("drawing an empty simulation doesn't throw", () => {
  const sim = createSim()
  const { ctx } = recorder()
  drawSensor(ctx, sim, DEFAULT_THEME, size)
  drawRaster(ctx, sim, DEFAULT_THEME, size, 0)
  drawMembrane(ctx, sim, DEFAULT_THEME, size, 0)
})

test("neuronAtY maps a pointer position to a raster row, clamped", () => {
  assert.equal(neuronAtY(0, 320, 32), 0)
  assert.equal(neuronAtY(15, 320, 32), 1)
  assert.equal(neuronAtY(319.9, 320, 32), 31)
  assert.equal(neuronAtY(400, 320, 32), 31)
  assert.equal(neuronAtY(-5, 320, 32), 0)
  assert.equal(neuronAtY(10, 0, 32), 0)
})
