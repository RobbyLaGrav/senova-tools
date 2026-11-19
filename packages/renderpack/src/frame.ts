// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Framing: find the render's background, trim uniform margins down to the object, flatten transparency onto a
// colour, and pad back out to one aspect ratio, so a set of product shots line up on a page.
import { createImage, type Rgba, type RgbaImage } from "./image.ts"

/** A rectangle in pixels. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** What surrounds the object: transparency, one flat colour, or nothing uniform (the corners disagree). */
export type Background = { kind: "transparent" } | { kind: "color"; color: Rgba } | { kind: "uneven" }

/** Pixels with alpha at or below this count as transparent background. */
export const ALPHA_THRESHOLD = 16

/**
 * Looks at the four corner pixels. All (nearly) transparent: a transparent background. All the same colour within
 * `tolerance` (0 to 255 per channel): that colour. Anything else: uneven, and nothing should be trimmed.
 */
export function detectBackground(img: RgbaImage, tolerance = 8): Background {
  const d = img.data
  const corners = [0, img.width - 1, (img.height - 1) * img.width, img.height * img.width - 1].map((p) => p * 4)
  if (corners.every((i) => d[i + 3]! <= ALPHA_THRESHOLD)) return { kind: "transparent" }
  if (corners.some((i) => d[i + 3]! < 255 - ALPHA_THRESHOLD)) return { kind: "uneven" }
  for (const i of corners) {
    for (const j of corners) {
      for (let c = 0; c < 3; c++) if (Math.abs(d[i + c]! - d[j + c]!) > tolerance) return { kind: "uneven" }
    }
  }
  const avg = (c: number) => Math.round(corners.reduce((s, i) => s + d[i + c]!, 0) / corners.length)
  return { kind: "color", color: { r: avg(0), g: avg(1), b: avg(2), a: 255 } }
}

/** True when the pixel at byte offset `i` belongs to the background. */
function isBackground(d: Uint8Array, i: number, bg: Background, tolerance: number): boolean {
  if (d[i + 3]! <= ALPHA_THRESHOLD) return true
  if (bg.kind !== "color") return false
  const c = bg.color
  return Math.abs(d[i]! - c.r) <= tolerance && Math.abs(d[i + 1]! - c.g) <= tolerance && Math.abs(d[i + 2]! - c.b) <= tolerance
}

export interface Content {
  /** The smallest box holding every non-background pixel, or null when the image is all background. */
  box: Box | null
  /** Share of all pixels (0 to 1) that are not background. */
  filled: number
}

/** Finds the object: everything that differs from the background by more than `tolerance`. */
export function findContent(img: RgbaImage, bg: Background, tolerance = 8): Content {
  if (bg.kind === "uneven") return { box: { x: 0, y: 0, width: img.width, height: img.height }, filled: 1 }
  const d = img.data
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1, count = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0, i = y * img.width * 4; x < img.width; x++, i += 4) {
      if (isBackground(d, i, bg, tolerance)) continue
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const filled = count / (img.width * img.height)
  if (maxX < 0) return { box: null, filled: 0 }
  return { box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, filled }
}

/** Copies out a rectangle. */
export function crop(img: RgbaImage, box: Box): RgbaImage {
  const { x, y, width, height } = box
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > img.width || y + height > img.height) {
    throw new RangeError(`crop box ${width} x ${height} at (${x}, ${y}) is outside the ${img.width} x ${img.height} image`)
  }
  const out = new Uint8Array(width * height * 4)
  for (let r = 0; r < height; r++) {
    const s = ((y + r) * img.width + x) * 4
    out.set(img.data.subarray(s, s + width * 4), r * width * 4)
  }
  return { width, height, data: out }
}

/** Composites the image over an opaque colour, so no transparency is left. */
export function flatten(img: RgbaImage, background: Rgba): RgbaImage {
  const out = new Uint8Array(img.data.length)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!
    if (a === 255) {
      out[i] = d[i]!
      out[i + 1] = d[i + 1]!
      out[i + 2] = d[i + 2]!
    } else {
      out[i] = Math.round((d[i]! * a + background.r * (255 - a)) / 255)
      out[i + 1] = Math.round((d[i + 1]! * a + background.g * (255 - a)) / 255)
      out[i + 2] = Math.round((d[i + 2]! * a + background.b * (255 - a)) / 255)
    }
    out[i + 3] = 255
  }
  return { width: img.width, height: img.height, data: out }
}

export interface PadOptions {
  /** Width divided by height of the result (e.g. 4 / 3). Omit to keep the content's own shape. */
  aspect?: number
  /** Space kept on every side, as a share of the result's width or height (0 to 0.45). Default 0. */
  margin?: number
  /** Colour of the added space. Default transparent. */
  background?: Rgba
}

/** Places the image in the middle of a larger canvas with the given aspect ratio and margin. Never scales. */
export function pad(img: RgbaImage, options: PadOptions = {}): RgbaImage {
  const margin = options.margin ?? 0
  if (!(margin >= 0 && margin <= 0.45)) throw new RangeError(`margin must be between 0 and 0.45, got ${margin}`)
  const aspect = options.aspect
  if (aspect !== undefined && !(aspect > 0 && Number.isFinite(aspect))) throw new RangeError(`aspect must be a positive number, got ${aspect}`)
  let W = Math.ceil(img.width / (1 - 2 * margin))
  let H = Math.ceil(img.height / (1 - 2 * margin))
  if (aspect !== undefined) {
    if (W / H < aspect) W = Math.max(W, Math.round(H * aspect))
    else H = Math.max(H, Math.round(W / aspect))
  }
  if (W === img.width && H === img.height) return { width: W, height: H, data: img.data.slice() }
  const out = createImage(W, H, options.background ?? { r: 0, g: 0, b: 0, a: 0 })
  const ox = Math.floor((W - img.width) / 2)
  const oy = Math.floor((H - img.height) / 2)
  for (let r = 0; r < img.height; r++) {
    out.data.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((oy + r) * W + ox) * 4)
  }
  return out
}

/** Parses "4:3", "16/9", "1" or 1.5 into width divided by height. */
export function parseAspect(value: string | number): number {
  if (typeof value === "number") {
    if (value > 0 && Number.isFinite(value)) return value
  } else {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[:/x]\s*(\d+(?:\.\d+)?))?\s*$/.exec(value)
    if (m) {
      const v = Number(m[1]) / (m[2] !== undefined ? Number(m[2]) : 1)
      if (v > 0 && Number.isFinite(v)) return v
    }
  }
  throw new TypeError(`not an aspect ratio: "${value}" (use 4:3, 16:9, 1:1 or a number)`)
}
