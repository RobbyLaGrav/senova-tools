// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { SPIKESIM_CSS, SpikeSim } from "../src/react.ts"

// Server rendering runs no effects, so this checks the markup without a browser or a canvas.

test("renders the controls, the three panels and the counters", () => {
  const html = renderToString(createElement(SpikeSim))
  assert.match(html, /class="spikesim"/)
  assert.match(html, /role="radiogroup" aria-label="Spot motion"/)
  assert.match(html, /role="radiogroup" aria-label="Sensor noise"/)
  assert.match(html, /aria-checked="true"[^>]*>Slow</)
  assert.match(html, /aria-pressed="true"[^>]*>Pause</)
  assert.equal(html.match(/<canvas/g)?.length, 3)
  assert.match(html, /Neuron 17: membrane potential/)
  assert.match(html, /less work when only changes are processed/)
  assert.ok(html.includes("<style>"))
})

test("options and props change what is offered", () => {
  const html = renderToString(
    createElement(SpikeSim, { options: { neurons: { count: 8 } }, speeds: [{ label: "Crawl", hz: 0.1 }], initialSpeed: 0, autoPlay: false, unstyled: true, className: "mine" }),
  )
  assert.match(html, /class="spikesim mine"/)
  assert.match(html, /Spike raster of 8 neurons/)
  assert.match(html, /Neuron 5: membrane potential/)
  assert.match(html, />Crawl</)
  assert.match(html, /aria-pressed="false"[^>]*>Play</)
  assert.ok(!html.includes("<style>"))
})

test("every built-in style has zero specificity", () => {
  const rules = SPIKESIM_CSS.trim().split("\n")
  assert.ok(rules.length > 10)
  for (const r of rules) assert.ok(r.startsWith(":where("), r)
})
