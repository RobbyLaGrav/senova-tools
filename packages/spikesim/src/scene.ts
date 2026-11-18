// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

/** A point in pixel units: pixel (x, y) covers [x, x + 1) by [y, y + 1), so its centre is (x + 0.5, y + 0.5). */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * What the event camera looks at. The simulator calls `advance` once per step, then samples `brightness` at every
 * pixel centre. Write your own to test the network on other stimuli.
 */
export interface Scene {
  /** Move the scene's own clock forward by `dtMs` milliseconds. */
  advance(dtMs: number): void
  /** Light intensity at a point, in arbitrary units. Must be greater than 0 (the sensor takes its logarithm). */
  brightness(x: number, y: number): number
  /** Where the tracked object really is, for measuring decoding error, or null if there is nothing to track. */
  target(): Point | null
}

export interface SpotSceneOptions {
  /** Sensor width in pixels; the spot moves around the centre. Default 24. */
  width?: number
  /** Sensor height in pixels. Default 16. */
  height?: number
  /** How fast the spot moves, in cycles per second of simulated time. 0 holds it still. Default 0.35. */
  speedHz?: number
  /** Horizontal swing either side of the centre, in pixels. Default 0.375 x width. */
  amplitudeX?: number
  /** Vertical swing either side of the centre, in pixels. Default 0.22 x height. */
  amplitudeY?: number
  /** Gaussian radius (standard deviation) of the spot, in pixels. Default 1.7. */
  radius?: number
  /** Brightness of the background, with the spot's peak at 1. Default 0.08. */
  background?: number
}

/** A bright Gaussian spot on a dim background, moving on a smooth Lissajous path. */
export interface SpotScene extends Scene {
  /** Speed in cycles per second. Change it at any time: the path continues smoothly from where it is. */
  speedHz: number
}

/**
 * The scene from the demo: a bright spot drifting left and right (and a little up and down).
 * The phase is accumulated step by step, so changing `speedHz` mid-run never makes the spot jump.
 */
export function createSpotScene(options: SpotSceneOptions = {}): SpotScene {
  const width = options.width ?? 24
  const height = options.height ?? 16
  const ampX = options.amplitudeX ?? 0.375 * width
  const ampY = options.amplitudeY ?? 0.22 * height
  const radius = options.radius ?? 1.7
  const background = options.background ?? 0.08
  if (!(radius > 0)) throw new RangeError("radius must be greater than 0")
  if (!(background > 0 && background < 1)) throw new RangeError("background must be between 0 and 1 (exclusive)")
  const twoR2 = 2 * radius * radius
  let phase = 0
  let x = width / 2
  let y = height / 2 + ampY * Math.sin(0.6)

  const scene: SpotScene = {
    speedHz: options.speedHz ?? 0.35,
    advance(dtMs) {
      phase += (2 * Math.PI * scene.speedHz * dtMs) / 1000
      x = width / 2 + ampX * Math.sin(phase)
      y = height / 2 + ampY * Math.sin(phase * 0.7 + 0.6)
    },
    brightness(px, py) {
      return background + (1 - background) * Math.exp(-((px - x) ** 2 + (py - y) ** 2) / twoR2)
    },
    target() {
      return { x, y }
    },
  }
  return scene
}
