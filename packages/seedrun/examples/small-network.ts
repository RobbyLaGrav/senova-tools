// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's "@senova/seedrun/ml" example: fit sin(3x) with a 16-unit network. Run: node examples/small-network.ts
import { createRng } from "../src/index.ts"
import { mlp, predict, train } from "../src/ml.ts"

const rng = createRng(3)
const X = Array.from({ length: 256 }, () => [rng.uniform(-1, 1)])
const Y = X.map(([x]) => [Math.sin(3 * x!)])
const net = mlp([1, 16, 1], { seed: 5 })
const curve = train(net, X, Y, { epochs: 60, batch: 8, lr: 1e-2, lrDecay: 0.95 })
console.log(curve.at(-1), predict(net, [0.5])[0], Math.sin(1.5)) // 0.00618 0.938 0.997: same digits on every run
