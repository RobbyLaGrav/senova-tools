// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The core without React: lay out a chart and print the SVG paths and ticks it would draw.
// Run: node packages/smoothchart/examples/core.ts

import { layoutLineChart, nearestPoint, smoothPath } from "../src/index.ts"

const layout = layoutLineChart({
  series: [
    { name: "Before", points: [[1, 120], [2, 180], [4, 260], [8, 410]] },
    { name: "After", points: [[1, 40], [2, 52], [4, 61], [8, 75]], highlight: true },
  ],
  xMin: 1,
})

for (const [i, line] of layout.lines.entries()) console.log(`series ${i}: ${smoothPath(line)}`)
console.log("y ticks:", layout.yTicks.map((t) => t.value).join(", "))

// the pointer at the "After" line's third point, 5 px off: hover picks that line only
const [px, py] = layout.lines[1]?.[2] ?? [0, 0]
console.log("hover picks:", nearestPoint(layout.lines, px + 3, py + 4))
