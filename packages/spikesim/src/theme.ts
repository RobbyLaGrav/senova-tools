// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

/** Colours the canvas renderer uses. Any CSS colour string works. */
export interface Theme {
  /** Canvas background. */
  background: string
  /** Text, spikes of unselected neurons. */
  foreground: string
  /** Secondary marks: the true-position ring, the threshold line. */
  muted: string
  /** Pixel cells and the selected raster row. */
  surface: string
  /** ON events (brightness went up). */
  on: string
  /** OFF events (brightness went down). */
  off: string
  /** The decoded position, the selected neuron's spikes and its membrane trace. */
  accent: string
}

/** The CSS custom property behind each theme colour. Set them on the component, or any ancestor, to restyle it. */
export const THEME_VARIABLES: Readonly<Record<keyof Theme, string>> = {
  background: "--spikesim-bg",
  foreground: "--spikesim-fg",
  muted: "--spikesim-muted",
  surface: "--spikesim-surface",
  on: "--spikesim-on",
  off: "--spikesim-off",
  accent: "--spikesim-accent",
}

/** Light-mode fallbacks, used for any variable that isn't set. */
export const DEFAULT_THEME: Readonly<Theme> = {
  background: "#ffffff",
  foreground: "#0b0b0c",
  muted: "#5c5d65",
  surface: "#ebebed",
  on: "#2747d6",
  off: "#0b0b0c",
  accent: "#2747d6",
}

/**
 * Read the theme from CSS custom properties on `element`. Each colour is resolved by the browser (through a hidden
 * probe element), so values like `light-dark(#fff, #111)`, `oklch(...)` or `var(--brand)` all work on a canvas.
 */
export function readTheme(element: Element, fallback: Readonly<Theme> = DEFAULT_THEME): Theme {
  const doc = element.ownerDocument
  const view = doc.defaultView
  if (!view) return { ...fallback }
  const probe = doc.createElement("span")
  probe.style.display = "none"
  element.appendChild(probe)
  const out = { ...fallback }
  try {
    const own = view.getComputedStyle(element)
    for (const key of Object.keys(THEME_VARIABLES) as (keyof Theme)[]) {
      const name = THEME_VARIABLES[key]
      if (!own.getPropertyValue(name).trim()) continue
      probe.style.color = `var(${name})`
      const resolved = view.getComputedStyle(probe).color
      if (resolved) out[key] = resolved
    }
  } finally {
    probe.remove()
  }
  return out
}
