// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example: two independent parts and a merge. From this folder:
//   node ../../src/bin.ts run --all     (both parts side by side)
//   node ../../src/bin.ts merge         (writes results.json)
// In your own project, import from "@senova/seedrun" and run `npx seedrun ...` instead.
import { defineExperiment, percentile, round } from "../../src/index.ts"

export default defineExperiment({
  name: "monte-carlo",
  seed: 2026,
  parts: {
    // Estimate pi from random points in the unit square.
    pi: ({ rng, log }) => {
      const n = 1_000_000
      let inside = 0
      for (let i = 0; i < n; i++) {
        const x = rng.next(), y = rng.next()
        if (x * x + y * y < 1) inside++
      }
      log(`${n} points`)
      return { points: n, pi: round((4 * inside) / n, 5) }
    },
    // How far 1,000 random walks of 1,000 unit steps end up from the start.
    walks: ({ rng }) => {
      const distances: number[] = []
      for (let w = 0; w < 1000; w++) {
        let x = 0, y = 0
        for (let s = 0; s < 1000; s++) {
          const angle = rng.uniform(0, 2 * Math.PI)
          x += Math.cos(angle)
          y += Math.sin(angle)
        }
        distances.push(Math.hypot(x, y))
      }
      return { walks: 1000, steps: 1000, median: round(percentile(distances, 50), 2), p95: round(percentile(distances, 95), 2) }
    },
  },
  merge: ({ pi, walks }) => ({ pi, walks, note: "Simulated with seeded draws; re-running gives the same bytes." }),
})
