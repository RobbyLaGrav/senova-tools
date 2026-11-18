// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The example page's script. Plain JavaScript with createElement, so it runs in the browser without a build step;
// in an app you'd write the same thing in JSX. It imports the built package from ../dist (npm run build first).

import { createElement as h, useState } from "react"
import { createRoot } from "react-dom/client"

import { BarChart, LineChart } from "../dist/react.js"

const sizes = [1, 2, 4, 8, 16, 32, 64]
const latency = (base, growth, noise) => sizes.map((n, i) => [n, Math.round(base * growth ** i * (1 + noise * Math.sin(i * 2.3)))])

function makeSeries(seed) {
  const k = 1 + 0.25 * Math.sin(seed)
  return [
    { name: "Baseline", points: latency(12 * k, 1.9, 0.05) },
    { name: "Cached", points: latency(9 * k, 1.45, 0.08), dashed: true },
    { name: "New scheduler", points: latency(6 * k, 1.3, 0.04), highlight: true, area: true },
  ]
}

function Demo() {
  const [seed, setSeed] = useState(0)
  const [logY, setLogY] = useState(true)
  const series = makeSeries(seed)
  const bars = [
    { label: "New scheduler", value: series[2].points.at(-1)[1], highlight: true, detail: "Work stealing with per-core queues." },
    { label: "Cached", value: series[1].points.at(-1)[1], detail: "Results cached between runs." },
    { label: "Baseline", value: series[0].points.at(-1)[1], detail: "One shared queue." },
  ]
  return h(
    "div",
    null,
    h(
      "div",
      { className: "controls" },
      h("button", { type: "button", onClick: () => setSeed((s) => s + 1) }, "New data (watch the lines glide)"),
      h("button", { type: "button", onClick: () => setLogY((v) => !v) }, logY ? "Linear y axis" : "Log y axis"),
    ),
    h("h2", null, "Line chart"),
    h(LineChart, {
      title: "Latency as the job count doubles. The shaded range is when the cache was warming up.",
      series,
      xLabel: "Parallel jobs",
      yLabel: "Latency (ms)",
      yUnit: " ms",
      xUnit: " jobs",
      logX: true,
      logY,
      bands: [{ from: 1, to: 2, label: "Cache warming" }],
    }),
    h("h2", null, "Bar chart"),
    h(BarChart, { title: "Latency at 64 jobs. Point at a bar for details.", bars, unit: "ms", digits: 0, lowerIsBetter: true }),
  )
}

createRoot(document.getElementById("app")).render(h(Demo))
