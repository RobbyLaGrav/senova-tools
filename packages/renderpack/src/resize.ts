// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// High-quality resize. Two separable passes (rows, then columns), done in linear light with premultiplied alpha:
// - linear light, because averaging sRGB values darkens thin bright edges and fine lines (a common CAD render look);
// - premultiplied alpha, so fully transparent pixels (whatever colour they hold) never bleed into the edges.
// Filters: "bicubic" is Mitchell-Netravali (B = C = 1/3), stretched by the scale factor when shrinking, so every source
// pixel contributes; "area" is an exact box filter (each output pixel is the area-weighted mean of what it covers).
import type { RgbaImage } from "./image.ts"

export type ResizeFilter = "bicubic" | "area"

export interface ResizeOptions {
  filter?: ResizeFilter
}

const TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const LUT_SIZE = 4096
const TO_SRGB = new Uint8Array(LUT_SIZE + 1)
for (let i = 0; i <= LUT_SIZE; i++) {
  const l = i / LUT_SIZE
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055
  TO_SRGB[i] = Math.round(c * 255)
}

/** sRGB 8-bit to linear 0..1. */
export function srgbToLinear(v: number): number {
  return TO_LINEAR[v]!
}

/** Linear 0..1 to sRGB 8-bit (clamped). */
export function linearToSrgb(l: number): number {
  if (!(l > 0)) return 0
  if (l >= 1) return 255
  return TO_SRGB[Math.round(l * LUT_SIZE)]!
}

function mitchell(x: number): number {
  const B = 1 / 3, C = 1 / 3
  x = Math.abs(x)
  if (x < 1) return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x ** 2 + (6 - 2 * B)) / 6
  if (x < 2) return ((-B - 6 * C) * x ** 3 + (6 * B + 30 * C) * x ** 2 + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6
  return 0
}

interface Taps {
  start: Int32Array
  count: Int32Array
  weights: Float32Array
  stride: number
}

// For every output index along one axis: which input indices contribute and with what (normalised) weight.
function taps(src: number, dst: number, filter: ResizeFilter): Taps {
  const scale = src / dst
  const stretch = Math.max(scale, 1)
  const radius = filter === "area" ? scale / 2 + 1 : 2 * stretch
  const stride = Math.ceil(radius * 2) + 2
  const start = new Int32Array(dst)
  const count = new Int32Array(dst)
  const weights = new Float32Array(dst * stride)
  for (let i = 0; i < dst; i++) {
    let lo: number, hi: number
    const w: number[] = []
    if (filter === "area") {
      // The output pixel covers [a, b) in input coordinates; weight = overlap with each input pixel [j, j + 1).
      // When enlarging, fall back to linear interpolation so the result is still smooth.
      if (scale >= 1) {
        const a = i * scale, b = (i + 1) * scale
        lo = Math.floor(a)
        hi = Math.min(src - 1, Math.ceil(b) - 1)
        for (let j = lo; j <= hi; j++) w.push(Math.max(0, Math.min(b, j + 1) - Math.max(a, j)))
      } else {
        const c = (i + 0.5) * scale - 0.5
        lo = Math.floor(c)
        hi = lo + 1
        const t = c - lo
        w.push(1 - t, t)
      }
    } else {
      const c = (i + 0.5) * scale - 0.5
      lo = Math.ceil(c - 2 * stretch)
      hi = Math.floor(c + 2 * stretch)
      for (let j = lo; j <= hi; j++) w.push(mitchell((j - c) / stretch))
    }
    // Edges: clamp out-of-range taps onto the border pixel (fold their weight in).
    const folded = new Map<number, number>()
    for (let k = 0; k < w.length; k++) {
      const j = Math.min(src - 1, Math.max(0, lo + k))
      folded.set(j, (folded.get(j) ?? 0) + w[k]!)
    }
    const js = [...folded.keys()].sort((p, q) => p - q)
    const first = js[0]!
    const last = js[js.length - 1]!
    let sum = 0
    for (const v of folded.values()) sum += v
    start[i] = first
    count[i] = last - first + 1
    if (count[i]! > stride) throw new Error("resize: tap window overflow (bug)")
    for (const [j, v] of folded) weights[i * stride + (j - first)] = sum !== 0 ? v / sum : 0
  }
  return { start, count, weights, stride }
}

/** Resizes to exactly `width` x `height`. Use `resizeToWidth` to keep the aspect ratio. */
export function resize(img: RgbaImage, width: number, height: number, options: ResizeOptions = {}): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`resize target must be whole numbers of at least 1, got ${width} x ${height}`)
  }
  const filter = options.filter ?? "bicubic"
  if (filter !== "bicubic" && filter !== "area") throw new TypeError(`unknown filter "${String(filter)}" (bicubic or area)`)
  if (width === img.width && height === img.height) return { width, height, data: img.data.slice() }
  const sw = img.width, sh = img.height
  const src = img.data

  // Pass 1: rows. Source (sw x sh, sRGB, straight alpha) -> mid (width x sh, linear, premultiplied).
  const tx = taps(sw, width, filter)
  const mid = new Float32Array(width * sh * 4)
  const rowLin = new Float32Array(sw * 4)
  for (let y = 0; y < sh; y++) {
    for (let x = 0, s = y * sw * 4; x < sw; x++, s += 4) {
      const a = src[s + 3]! / 255
      rowLin[x * 4] = TO_LINEAR[src[s]!]! * a
      rowLin[x * 4 + 1] = TO_LINEAR[src[s + 1]!]! * a
      rowLin[x * 4 + 2] = TO_LINEAR[src[s + 2]!]! * a
      rowLin[x * 4 + 3] = a
    }
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      const st = tx.start[x]!, n = tx.count[x]!, wo = x * tx.stride
      for (let k = 0; k < n; k++) {
        const w = tx.weights[wo + k]!
        const p = (st + k) * 4
        r += rowLin[p]! * w
        g += rowLin[p + 1]! * w
        b += rowLin[p + 2]! * w
        a += rowLin[p + 3]! * w
      }
      const o = (y * width + x) * 4
      mid[o] = r
      mid[o + 1] = g
      mid[o + 2] = b
      mid[o + 3] = a
    }
  }

  // Pass 2: columns. mid -> out (width x height), back to sRGB and straight alpha.
  const ty = taps(sh, height, filter)
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const st = ty.start[y]!, n = ty.count[y]!, wo = y * ty.stride
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let k = 0; k < n; k++) {
        const w = ty.weights[wo + k]!
        const p = ((st + k) * width + x) * 4
        r += mid[p]! * w
        g += mid[p + 1]! * w
        b += mid[p + 2]! * w
        a += mid[p + 3]! * w
      }
      const o = (y * width + x) * 4
      if (a <= 1 / 510) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
        continue
      }
      const alpha = Math.min(1, a)
      out[o] = linearToSrgb(r / a)
      out[o + 1] = linearToSrgb(g / a)
      out[o + 2] = linearToSrgb(b / a)
      out[o + 3] = Math.round(alpha * 255)
    }
  }
  return { width, height, data: out }
}

/** Resizes to `width`, with the height that keeps the aspect ratio (at least 1). */
export function resizeToWidth(img: RgbaImage, width: number, options: ResizeOptions = {}): RgbaImage {
  return resize(img, width, Math.max(1, Math.round((img.height * width) / img.width)), options)
}
