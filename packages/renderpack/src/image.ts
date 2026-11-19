// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The one in-memory image shape every step works on: 8-bit RGBA, straight (not premultiplied) alpha, rows top to bottom.

/** An 8-bit RGBA image. `data` has `width * height * 4` bytes. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array
}

/** A colour as 8-bit red, green, blue and alpha. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Makes a blank image filled with one colour (transparent black by default). */
export function createImage(width: number, height: number, fill: Rgba = { r: 0, g: 0, b: 0, a: 0 }): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`image size must be whole numbers of at least 1, got ${width} x ${height}`)
  }
  const data = new Uint8Array(width * height * 4)
  if (fill.r !== 0 || fill.g !== 0 || fill.b !== 0 || fill.a !== 0) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill.r
      data[i + 1] = fill.g
      data[i + 2] = fill.b
      data[i + 3] = fill.a
    }
  }
  return { width, height, data }
}

/** Reads the pixel at (x, y). */
export function pixel(img: RgbaImage, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4
  const d = img.data
  return { r: d[i]!, g: d[i + 1]!, b: d[i + 2]!, a: d[i + 3]! }
}

/**
 * Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `white`, `black` or `transparent`.
 * Throws on anything else, so a typo in a colour never silently becomes black.
 */
export function parseColor(text: string): Rgba {
  const t = text.trim().toLowerCase()
  if (t === "white") return { r: 255, g: 255, b: 255, a: 255 }
  if (t === "black") return { r: 0, g: 0, b: 0, a: 255 }
  if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t)
  if (!m) throw new TypeError(`not a colour: "${text}" (use #rrggbb, #rgb, white, black or transparent)`)
  let hex = m[1]!
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("")
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 255 }
}

/** Formats a colour as `#rrggbb` (or `#rrggbbaa` when not opaque). */
export function formatColor(c: Rgba): string {
  const h = (v: number) => v.toString(16).padStart(2, "0")
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a === 255 ? "" : h(c.a)}`
}

/** True when every pixel is fully opaque. */
export function isOpaque(img: RgbaImage): boolean {
  const d = img.data
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false
  return true
}
