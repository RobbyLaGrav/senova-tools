// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

// Spikesim: event camera -> leaky integrate-and-fire neurons -> population-vector decoder, with operation counts.
// The engine (createSim) is plain TypeScript with no DOM; the renderer and loop need a browser.
// The React component is a separate entry point: @senova/spikesim/react.

export {
  createSim,
  resolveConfig,
  type AccountingConfig,
  type DecoderConfig,
  type NeuronConfig,
  type OperationTotals,
  type Rates,
  type SensorConfig,
  type Sim,
  type SimConfig,
  type SimOptions,
  type SimState,
  type Spike,
  type StepResult,
} from "./engine.ts"
export { createSpotScene, type Point, type Scene, type SpotScene, type SpotSceneOptions } from "./scene.ts"
export { buildWeights, evenlySpaced, type ReceptiveFieldConfig } from "./receptive-fields.ts"
export { createRandom } from "./random.ts"
export {
  createRenderer,
  drawMembrane,
  drawRaster,
  drawSensor,
  fitCanvas,
  neuronAtY,
  type Context2D,
  type Renderer,
  type RendererCanvases,
  type SensorDrawOptions,
  type Size,
} from "./render.ts"
export { DEFAULT_THEME, THEME_VARIABLES, readTheme, type Theme } from "./theme.ts"
export { startLoop, type Loop, type LoopOptions } from "./loop.ts"
export { formatRate, formatRatio } from "./format.ts"
