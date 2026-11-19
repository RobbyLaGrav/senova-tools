// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// PNG decode and encode on node:zlib, no dependencies (PNG spec, W3C, third edition).
// Decode: every standard colour type and bit depth (1, 2, 4, 8, 16), palette and tRNS transparency, Adam7
// interlacing. Every chunk CRC is checked, and the image data is inflated with a hard cap at the size the header
// promises, so a small file can't expand into gigabytes. Colour profiles (gAMA, cHRM, iCCP) are ignored: sRGB is assumed.
// Encode: 8-bit greyscale, grey+alpha, RGB or RGBA (the smallest that holds the image losslessly), with the
// per-row filter picked by the minimum-sum-of-absolute-differences rule and deflate level 9.
import { crc32, deflateSync, inflateSync } from "node:zlib"

import type { RgbaImage } from "./image.ts"

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Default cap on decoded pixels (50 megapixels, about 200 MB as RGBA). */
export const DEFAULT_MAX_PIXELS = 50_000_000

/** Raised for any file that isn't a valid, supported PNG. The message says what is wrong. */
export class PngError extends Error {
  override name = "PngError"
}

export interface DecodeOptions {
  /** Refuse images with more pixels than this (default 50 million). */
  maxPixels?: number
}

/** What the header said, plus the decoded pixels. */
export interface DecodedPng extends RgbaImage {
  bitDepth: number
  colorType: 0 | 2 | 3 | 4 | 6
  interlaced: boolean
  /** True when the file can carry transparency (an alpha channel or a tRNS chunk). */
  hasAlpha: boolean
}

/** True when the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return false
  return true
}

const ALLOWED_DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
// Adam7 passes: x start, y start, x step, y step.
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const

/** Decodes a PNG into 8-bit RGBA. Throws `PngError` on anything malformed or unsupported. */
export function decodePng(bytes: Uint8Array, options: DecodeOptions = {}): DecodedPng {
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS
  if (!isPng(bytes)) throw new PngError("not a PNG file (the 8-byte signature is missing)")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let pos = 8
  let header: { width: number; height: number; bitDepth: number; colorType: 0 | 2 | 3 | 4 | 6; interlaced: boolean } | undefined
  let palette: Uint8Array | undefined
  let trns: Uint8Array | undefined
  const idat: Uint8Array[] = []
  let idatState: "before" | "in" | "after" = "before"
  let ended = false

  while (pos < bytes.length) {
    if (pos + 12 > bytes.length) throw new PngError(`file is truncated: a chunk header at byte ${pos} is cut off`)
    const length = view.getUint32(pos)
    if (length > 0x7fffffff) throw new PngError(`chunk at byte ${pos} has an impossible length ${length}`)
    const typeBytes = bytes.subarray(pos + 4, pos + 8)
    const type = String.fromCharCode(...typeBytes)
    if (!/^[A-Za-z]{4}$/.test(type)) throw new PngError(`chunk at byte ${pos} has an invalid type (not four letters)`)
    if (pos + 12 + length > bytes.length) throw new PngError(`file is truncated: the ${type} chunk at byte ${pos} is cut off`)
    const data = bytes.subarray(pos + 8, pos + 8 + length)
    const stored = view.getUint32(pos + 8 + length)
    const actual = crc32(bytes.subarray(pos + 4, pos + 8 + length))
    if (stored !== actual) throw new PngError(`CRC mismatch in the ${type} chunk at byte ${pos}: the file is corrupt`)
    pos += 12 + length

    if (header === undefined && type !== "IHDR") throw new PngError(`the first chunk must be IHDR, found ${type}`)
    if (type !== "IDAT" && idatState === "in") idatState = "after"
    switch (type) {
      case "IHDR": {
        if (header !== undefined) throw new PngError("more than one IHDR chunk")
        if (length !== 13) throw new PngError(`IHDR must be 13 bytes, found ${length}`)
        const dv = new DataView(data.buffer, data.byteOffset, 13)
        const width = dv.getUint32(0)
        const height = dv.getUint32(4)
        const bitDepth = data[8]!
        const colorType = data[9]!
        if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) {
          throw new PngError(`invalid image size ${width} x ${height}`)
        }
        const depths = ALLOWED_DEPTHS[colorType]
        if (depths === undefined) throw new PngError(`invalid colour type ${colorType}`)
        if (!depths.includes(bitDepth)) throw new PngError(`bit depth ${bitDepth} is not valid for colour type ${colorType}`)
        if (data[10] !== 0) throw new PngError(`unknown compression method ${data[10]}`)
        if (data[11] !== 0) throw new PngError(`unknown filter method ${data[11]}`)
        if (data[12] !== 0 && data[12] !== 1) throw new PngError(`unknown interlace method ${data[12]}`)
        if (width * height > maxPixels) {
          throw new PngError(`image is ${width} x ${height} (${(width * height / 1e6).toFixed(1)} MP), over the ${(maxPixels / 1e6).toFixed(1)} MP limit`)
        }
        header = { width, height, bitDepth, colorType: colorType as 0 | 2 | 3 | 4 | 6, interlaced: data[12] === 1 }
        break
      }
      case "PLTE": {
        if (idatState !== "before") throw new PngError("PLTE chunk after the image data")
        if (palette !== undefined) throw new PngError("more than one PLTE chunk")
        if (length === 0 || length % 3 !== 0 || length / 3 > 256) throw new PngError(`PLTE length ${length} is not 1 to 256 RGB entries`)
        if (header!.colorType === 0 || header!.colorType === 4) throw new PngError("PLTE chunk is not allowed in a greyscale image")
        palette = data
        break
      }
      case "tRNS": {
        if (idatState !== "before") throw new PngError("tRNS chunk after the image data")
        const ct = header!.colorType
        if (ct === 4 || ct === 6) throw new PngError("tRNS chunk is not allowed when the image has an alpha channel")
        if (ct === 0 && length !== 2) throw new PngError(`tRNS for greyscale must be 2 bytes, found ${length}`)
        if (ct === 2 && length !== 6) throw new PngError(`tRNS for RGB must be 6 bytes, found ${length}`)
        if (ct === 3) {
          if (palette === undefined) throw new PngError("tRNS chunk before PLTE")
          if (length > palette.length / 3) throw new PngError("tRNS has more entries than the palette")
        }
        trns = data
        break
      }
      case "IDAT":
        if (idatState === "after") throw new PngError("IDAT chunks are not consecutive")
        idatState = "in"
        idat.push(data)
        break
      case "IEND":
        ended = true
        break
      default:
        // Upper-case first letter = critical: a decoder that doesn't understand it must not show the image.
        if (typeBytes[0]! & 0x20) break
        throw new PngError(`unsupported critical chunk ${type}`)
    }
    if (ended) break
  }

  if (header === undefined) throw new PngError("no IHDR chunk")
  if (!ended) throw new PngError("file is truncated: no IEND chunk")
  if (idat.length === 0) throw new PngError("no image data (IDAT)")
  if (header.colorType === 3 && palette === undefined) throw new PngError("palette image without a PLTE chunk")

  const { width, height, bitDepth, colorType, interlaced } = header
  const channels = CHANNELS[colorType]!
  const bitsPerPixel = channels * bitDepth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const rowBytes = (w: number) => Math.ceil((w * bitsPerPixel) / 8)
  const passes = interlaced
    ? ADAM7.map(([x0, y0, dx, dy]) => ({ x0, y0, dx, dy, w: Math.ceil((width - x0) / dx), h: Math.ceil((height - y0) / dy) })).filter((p) => p.w > 0 && p.h > 0)
    : [{ x0: 0, y0: 0, dx: 1, dy: 1, w: width, h: height }]
  const expected = passes.reduce((sum, p) => sum + p.h * (1 + rowBytes(p.w)), 0)

  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected })
  } catch (err) {
    const msg = (err as Error).message
    if (err instanceof RangeError || /larger than|maxOutputLength/i.test(msg)) {
      throw new PngError("image data is larger than the header says (corrupt, or a decompression bomb)")
    }
    throw new PngError(`image data does not decompress: ${msg}`)
  }
  if (raw.length !== expected) throw new PngError(`image data is ${raw.length} bytes, expected ${expected}: the file is truncated or corrupt`)

  const out = new Uint8Array(width * height * 4)
  const sample = makeSampler(colorType, bitDepth, palette, trns)
  let offset = 0
  for (const p of passes) {
    const rb = rowBytes(p.w)
    let prev: Uint8Array = new Uint8Array(rb)
    for (let y = 0; y < p.h; y++) {
      const filter = raw[offset]!
      const line = raw.subarray(offset + 1, offset + 1 + rb)
      offset += 1 + rb
      unfilter(filter, line, prev, bpp, y + 1)
      const oy = p.y0 + y * p.dy
      for (let x = 0; x < p.w; x++) sample(line, x, out, (oy * width + p.x0 + x * p.dx) * 4)
      prev = line
    }
  }
  const hasAlpha = colorType === 4 || colorType === 6 || trns !== undefined
  return { width, height, data: out, bitDepth, colorType, interlaced, hasAlpha }
}

function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number, row: number): void {
  const n = line.length
  switch (filter) {
    case 0:
      return
    case 1:
      for (let i = bpp; i < n; i++) line[i] = (line[i]! + line[i - bpp]!) & 255
      return
    case 2:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + prev[i]!) & 255
      return
    case 3:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + (((i >= bpp ? line[i - bpp]! : 0) + prev[i]!) >> 1)) & 255
      return
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0
        const c = i >= bpp ? prev[i - bpp]! : 0
        line[i] = (line[i]! + paeth(a, prev[i]!, c)) & 255
      }
      return
    default:
      throw new PngError(`row ${row} uses unknown filter type ${filter}: the file is corrupt`)
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

type Sampler = (line: Uint8Array, x: number, out: Uint8Array, o: number) => void

function makeSampler(colorType: number, depth: number, palette: Uint8Array | undefined, trns: Uint8Array | undefined): Sampler {
  const to8 = (v: number) => (depth === 16 ? Math.round(v / 257) : depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1)))
  // Reads sample `index` (in units of samples, not bytes) from a row, at any depth.
  const read = (line: Uint8Array, index: number): number => {
    if (depth === 8) return line[index]!
    if (depth === 16) return (line[index * 2]! << 8) | line[index * 2 + 1]!
    const bit = index * depth
    return (line[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
  }
  const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
  switch (colorType) {
    case 0: {
      const key = trns ? u16(trns, 0) : -1
      return (line, x, out, o) => {
        const v = read(line, x)
        const g = to8(v)
        out[o] = out[o + 1] = out[o + 2] = g
        out[o + 3] = v === key ? 0 : 255
      }
    }
    case 2: {
      const key = trns ? [u16(trns, 0), u16(trns, 2), u16(trns, 4)] : undefined
      return (line, x, out, o) => {
        const r = read(line, x * 3), g = read(line, x * 3 + 1), b = read(line, x * 3 + 2)
        out[o] = to8(r)
        out[o + 1] = to8(g)
        out[o + 2] = to8(b)
        out[o + 3] = key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255
      }
    }
    case 3: {
      const pal = palette!
      const entries = pal.length / 3
      return (line, x, out, o) => {
        const i = read(line, x)
        if (i >= entries) throw new PngError(`pixel uses palette entry ${i}, but the palette has ${entries}`)
        out[o] = pal[i * 3]!
        out[o + 1] = pal[i * 3 + 1]!
        out[o + 2] = pal[i * 3 + 2]!
        out[o + 3] = trns && i < trns.length ? trns[i]! : 255
      }
    }
    case 4:
      return (line, x, out, o) => {
        const g = to8(read(line, x * 2))
        out[o] = out[o + 1] = out[o + 2] = g
        out[o + 3] = to8(read(line, x * 2 + 1))
      }
    default:
      return (line, x, out, o) => {
        for (let c = 0; c < 4; c++) out[o + c] = to8(read(line, x * 4 + c))
      }
  }
}

export interface EncodeOptions {
  /** Force a colour type instead of picking the smallest lossless one. */
  colorType?: 0 | 2 | 4 | 6
  /** zlib level 0 to 9 (default 9). */
  level?: number
}

/** Encodes 8-bit RGBA as a PNG, using the smallest colour type that keeps every pixel exactly. */
export function encodePng(img: RgbaImage, options: EncodeOptions = {}): Uint8Array {
  const { width, height, data } = img
  if (data.length !== width * height * 4) throw new RangeError(`image data is ${data.length} bytes, expected ${width * height * 4}`)
  let colorType = options.colorType
  if (colorType === undefined) {
    let grey = true
    let opaque = true
    for (let i = 0; i < data.length && (grey || opaque); i += 4) {
      if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) grey = false
      if (data[i + 3] !== 255) opaque = false
    }
    colorType = grey ? (opaque ? 0 : 4) : opaque ? 2 : 6
  }
  const channels = CHANNELS[colorType]!
  const pick = colorType === 0 ? [0] : colorType === 4 ? [0, 3] : colorType === 2 ? [0, 1, 2] : [0, 1, 2, 3]
  const rb = width * channels
  const filtered = new Uint8Array(height * (rb + 1))
  let prev = new Uint8Array(rb)
  let cur = new Uint8Array(rb)
  const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(rb))
  for (let y = 0; y < height; y++) {
    for (let x = 0, s = y * width * 4, d = 0; x < width; x++, s += 4) for (const c of pick) cur[d++] = data[s + c]!
    let best = 0
    let bestScore = Infinity
    for (let f = 0; f < 5; f++) {
      const out = candidates[f]!
      let score = 0
      for (let i = 0; i < rb; i++) {
        const a = i >= channels ? cur[i - channels]! : 0
        const b = prev[i]!
        const c = i >= channels ? prev[i - channels]! : 0
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c)
        const v = (cur[i]! - pred) & 255
        out[i] = v
        score += v < 128 ? v : 256 - v
      }
      if (score < bestScore) {
        bestScore = score
        best = f
      }
    }
    const o = y * (rb + 1)
    filtered[o] = best
    filtered.set(candidates[best]!, o + 1)
    ;[prev, cur] = [cur, prev]
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = colorType
  const idat = deflateSync(filtered, { level: options.level ?? 9, memLevel: 9 })
  return concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))])
}

/** Builds one chunk: length, type, data, CRC. Exported for tests that need hand-made files. */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** The PNG signature bytes, for tests that build files by hand. */
export const PNG_SIGNATURE: Uint8Array = SIGNATURE
