// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Test fixtures made in the test run: a PNG writer independent of src/png.ts (any colour type, bit depth, filter
// and Adam7 interlacing), and simple synthetic "renders" (a shaded part on a flat background).
import { crc32, deflateSync } from "node:zlib"

import { createImage, type Rgba, type RgbaImage } from "../src/image.ts"

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function rawChunk(type: string, data: Uint8Array | number[], badCrc = false): Uint8Array {
  const d = Uint8Array.from(data)
  const out = new Uint8Array(12 + d.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, d.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(d, 8)
  dv.setUint32(8 + d.length, (crc32(out.subarray(4, 8 + d.length)) ^ (badCrc ? 1 : 0)) >>> 0)
  return out
}

export function join(parts: (Uint8Array | number[])[]): Uint8Array {
  const arrs = parts.map((p) => Uint8Array.from(p))
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
  let o = 0
  for (const a of arrs) {
    out.set(a, o)
    o += a.length
  }
  return out
}

export function ihdr(width: number, height: number, bitDepth: number, colorType: number, interlace = 0): Uint8Array {
  const d = new Uint8Array(13)
  const dv = new DataView(d.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  d[8] = bitDepth
  d[9] = colorType
  d[12] = interlace
  return rawChunk("IHDR", d)
}

export interface HandPng {
  width: number
  height: number
  colorType: 0 | 2 | 3 | 4 | 6
  bitDepth: number
  /** Samples for pixel (x, y), one per channel, at the bit depth. */
  samples: (x: number, y: number) => number[]
  palette?: number[]
  trns?: number[]
  interlace?: boolean
  /** Filter type for each row (default: row index mod 5, so every filter is used). */
  filter?: (row: number) => number
  /** Extra chunks placed before IDAT. */
  extra?: Uint8Array[]
}

/** Writes a PNG the slow, obvious way, to test the decoder against. */
export function handPng(spec: HandPng): Uint8Array {
  const { width, height, colorType, bitDepth } = spec
  const ch = CHANNELS[colorType]!
  const bpp = Math.max(1, (ch * bitDepth) >> 3)
  const filterOf = spec.filter ?? ((r: number) => r % 5)
  const passes = spec.interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]]
  const bytes: number[] = []
  let row = 0
  for (const [x0, y0, dx, dy] of passes as [number, number, number, number][]) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy)
    if (pw <= 0 || ph <= 0) continue
    const rb = Math.ceil((pw * ch * bitDepth) / 8)
    let prev = new Array<number>(rb).fill(0)
    for (let y = 0; y < ph; y++) {
      // Pack samples into bytes, most significant bits first.
      const cur = new Array<number>(rb).fill(0)
      let bit = 0
      for (let x = 0; x < pw; x++) {
        for (const s of spec.samples(x0 + x * dx, y0 + y * dy)) {
          if (bitDepth === 16) {
            cur[bit >> 3] = s >> 8
            cur[(bit >> 3) + 1] = s & 255
          } else if (bitDepth === 8) cur[bit >> 3] = s
          else cur[bit >> 3]! |= s << (8 - bitDepth - (bit & 7))
          bit += bitDepth
        }
      }
      const f = filterOf(row++)
      bytes.push(f)
      for (let i = 0; i < rb; i++) {
        const a = i >= bpp ? cur[i - bpp]! : 0, b = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        const pred = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!
        bytes.push((cur[i]! - pred) & 255)
      }
      prev = cur
    }
  }
  const idat = deflateSync(Uint8Array.from(bytes))
  return join([
    SIG,
    ihdr(width, height, bitDepth, colorType, spec.interlace ? 1 : 0),
    ...(spec.palette ? [rawChunk("PLTE", spec.palette)] : []),
    ...(spec.trns ? [rawChunk("tRNS", spec.trns)] : []),
    ...(spec.extra ?? []),
    rawChunk("IDAT", idat),
    rawChunk("IEND", []),
  ])
}

/** A small deterministic pseudo-random generator for test data. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomImage(width: number, height: number, seed: number, alpha = true): RgbaImage {
  const r = rng(seed)
  const img = createImage(width, height)
  for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 && !alpha ? 255 : Math.floor(r() * 256)
  return img
}

export interface RenderSpec {
  width: number
  height: number
  background?: Rgba
  /** Object centre and size, in pixels. */
  cx: number
  cy: number
  rx: number
  ry: number
  /** Base colour of the part (shaded top-left to bottom-right). */
  color?: Rgba
  /** A hole in the middle, as a share of the radius. */
  hole?: number
}

/** A stand-in for a CAD render: a shaded elliptical part with a hole, anti-aliased, on a flat background. */
export function drawRender(spec: RenderSpec): RgbaImage {
  const bg = spec.background ?? { r: 255, g: 255, b: 255, a: 255 }
  const col = spec.color ?? { r: 70, g: 110, b: 160, a: 255 }
  const img = createImage(spec.width, spec.height, bg)
  const hole = spec.hole ?? 0.35
  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      // 4x4 supersampling for anti-aliased edges.
      let cover = 0
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const u = (x + (sx + 0.5) / 4 - spec.cx) / spec.rx
        const v = (y + (sy + 0.5) / 4 - spec.cy) / spec.ry
        const d = Math.hypot(u, v)
        if (d <= 1 && d >= hole) cover++
      }
      if (cover === 0) continue
      const shade = 0.75 + 0.5 * (((spec.cx - x) / spec.rx + (spec.cy - y) / spec.ry) * 0.25)
      const k = cover / 16
      const i = (y * spec.width + x) * 4
      const ch = (c: number, b: number) => Math.round(Math.min(255, Math.max(0, c * shade)) * k + b * (1 - k))
      if (bg.a === 0) {
        img.data[i] = Math.round(Math.min(255, col.r * shade))
        img.data[i + 1] = Math.round(Math.min(255, col.g * shade))
        img.data[i + 2] = Math.round(Math.min(255, col.b * shade))
        img.data[i + 3] = Math.round(255 * k)
      } else {
        img.data[i] = ch(col.r, bg.r)
        img.data[i + 1] = ch(col.g, bg.g)
        img.data[i + 2] = ch(col.b, bg.b)
        img.data[i + 3] = 255
      }
    }
  }
  return img
}

/** Paints a grey/white checkerboard of `tile` px squares over the whole image (a "fake transparency" screenshot). */
export function checkerboard(width: number, height: number, tile: number, light = 255, dark = 204): RgbaImage {
  const img = createImage(width, height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 ? dark : light
    const i = (y * width + x) * 4
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  return img
}
