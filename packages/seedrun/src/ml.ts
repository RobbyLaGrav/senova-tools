// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// "@senova/seedrun/ml": a small dense network with Adam, a column scaler and least squares, all seeded and
// dependency-free. Meant for small reproducible studies, not for large models.

export { forward, mlp, predict, train, type Activation, type Network, type NetworkOptions, type TrainOptions } from "./ml/network.ts"
export { scaler, type Scaler } from "./ml/scaler.ts"
export { applyLinear, leastSquares } from "./ml/linear.ts"
export { mean, percentile, rms, round } from "./stats.ts"
