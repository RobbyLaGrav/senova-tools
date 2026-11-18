// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The arithmetic behind <FitMath>, kept free of the DOM so it can be tested and reused outside React.

/** The smallest scale <FitMath> shrinks to by default, as a fraction of the natural size. */
export const DEFAULT_MIN_SCALE = 0.55

/**
 * How much to shrink an equation so it fits. `need` is its natural width and `room` the width available, both in
 * pixels. Returns a factor below 1 (use it as an `em` font size), or `null` when it already fits and needs no change.
 * Leaves 2% spare so rounding never brings a scrollbar back, and never goes below `minScale`.
 */
export function fitScale(need: number, room: number, minScale: number = DEFAULT_MIN_SCALE): number | null {
  if (!(need > 0) || !(room > 0) || need <= room) return null
  return Math.max(minScale, (room / need) * 0.98)
}
