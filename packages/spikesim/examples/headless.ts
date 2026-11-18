// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example. Run it with: npm run example -w @senova/spikesim
// (In your own project, import from "@senova/spikesim" instead of "../src/index.ts".)
import { createSim, createSpotScene, formatRate, formatRatio } from "../src/index.ts"

const scene = createSpotScene({ speedHz: 0.35 }) // a bright spot drifting across a 24 x 16 event camera
const sim = createSim({ seed: 1, sensor: { noiseHz: 1.5 }, scene })

sim.step(2000) // two seconds of simulated time, in 1 ms steps

const r = sim.rates() // per second, over the last second
console.log(`events/s           ${formatRate(r.eventsPerS)}`)
console.log(`spikes/s           ${formatRate(r.spikesPerS)}`)
console.log(`event-driven ops/s ${formatRate(r.eventDrivenOpsPerS)}`)
console.log(`clocked ops/s      ${formatRate(r.clockedOpsPerS)}`)
console.log(`less work          ${formatRatio(r.savingRatio)}`)
console.log(`decoding error     ${r.rmsErrorPx?.toFixed(2)} px rms`)
console.log(`spot at x = ${sim.state.target?.x.toFixed(1)}, network says x = ${sim.state.decoded?.toFixed(1)}`)

// Hold the spot still: the sensor goes quiet and event-driven work stops, while the clocked count doesn't change.
scene.speedHz = 0
sim.setNoiseHz(0)
sim.step(1000)
console.log(`still: events/s ${formatRate(sim.rates().eventsPerS)}, less work ${formatRatio(sim.rates().savingRatio)}`)
