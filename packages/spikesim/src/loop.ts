// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

// The browser animation loop: steps the simulator in proportion to real time, draws every frame, and stops
// completely while the element is off screen (no frames, no simulation, no battery).

import type { Sim } from "./engine.ts"

export interface LoopOptions {
  sim: Sim
  /** Called once per animation frame, after stepping. */
  draw: (sim: Sim) => void
  /** Simulated milliseconds per real millisecond. Default 0.25: a quarter of real time, so single spikes are visible. */
  timeScale?: number
  /** Longest real frame gap that is simulated, in milliseconds, so a stalled tab doesn't run a burst of steps. Default 64. */
  maxFrameMs?: number
  /** Pause while this element is outside the viewport. */
  element?: Element | null
  /** Start running at once. Default true. */
  playing?: boolean
}

export interface Loop {
  readonly playing: boolean
  play(): void
  pause(): void
  /** Change the speed of simulated time relative to real time. */
  setTimeScale(scale: number): void
  /** Stop the loop and release the observer. */
  destroy(): void
}

/** Run a simulator in the browser with requestAnimationFrame. */
export function startLoop(options: LoopOptions): Loop {
  const { sim, draw } = options
  const maxFrameMs = options.maxFrameMs ?? 64
  let timeScale = options.timeScale ?? 0.25
  let playing = options.playing ?? true
  let visible = true
  let raf = 0
  let last = 0
  let destroyed = false

  const frame = (now: number) => {
    raf = 0
    const dt = last ? Math.min(maxFrameMs, now - last) : 0
    last = now
    if (playing && dt > 0) sim.step(dt * timeScale)
    draw(sim)
    schedule()
  }
  const schedule = () => {
    if (!destroyed && visible && raf === 0) raf = requestAnimationFrame(frame)
  }
  const stop = () => {
    if (raf !== 0) cancelAnimationFrame(raf)
    raf = 0
    last = 0
  }

  let observer: IntersectionObserver | null = null
  if (options.element && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (!entry) return
      visible = entry.isIntersecting
      if (visible) schedule()
      else stop()
    })
    observer.observe(options.element)
  }
  schedule()

  return {
    get playing() {
      return playing
    },
    play() {
      playing = true
      last = 0
      schedule()
    },
    pause() {
      playing = false
    },
    setTimeScale(scale) {
      if (!(Number.isFinite(scale) && scale >= 0)) throw new RangeError(`timeScale must be a finite number of at least 0, got ${scale}`)
      timeScale = scale
    },
    destroy() {
      destroyed = true
      stop()
      observer?.disconnect()
    },
  }
}
