// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The checks behind the warnings: a perceptual hash for near-duplicates, a detector for a transparency checkerboard
// baked into the pixels (a screenshot of an editor instead of a real export), and file naming rules for the web.
import { flatten } from "./frame.ts"
import type { RgbaImage } from "./image.ts"
import { resize } from "./resize.ts"

/**
 * Difference hash (dHash): shrink to 9 x 8 grey, then one bit per pair of neighbours (is the left one darker?).
 * 64 bits as 16 hex digits. Small changes (resizing, re-encoding, a slight crop) move only a few bits.
 * Transparency is flattened onto white first, so the same object on transparent and on white hashes alike.
 */
export function dHash(img: RgbaImage): string {
  const small = resize(flatten(img, { r: 255, g: 255, b: 255, a: 255 }), 9, 8, { filter: "area" })
  const d = small.data
  let bits = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4
      const l = luma(d[i]!, d[i + 1]!, d[i + 2]!)
      const r = luma(d[i + 4]!, d[i + 5]!, d[i + 6]!)
      bits = (bits << 1n) | (l < r ? 1n : 0n)
    }
  }
  return bits.toString(16).padStart(16, "0")
}

/** Number of differing bits between two hex hashes of the same length. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length || !/^[0-9a-f]*$/i.test(a + b)) throw new TypeError("hashes must be hex strings of the same length")
  let x = BigInt(`0x${a || "0"}`) ^ BigInt(`0x${b || "0"}`)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Looks for the grey two-tone checkerboard that image editors draw behind transparency, baked into opaque pixels.
 * Each corner patch (up to 64 px) is tested: two grey levels in roughly equal share, laid out in square tiles that
 * alternate both across and down. Two or more corners matching counts as found. Returns the tile size, or null.
 */
export function detectCheckerboard(img: RgbaImage): { tileSize: number; corners: number } | null {
  const P = Math.min(64, Math.floor(img.width / 3), Math.floor(img.height / 3))
  if (P < 12) return null
  const origins = [[0, 0], [img.width - P, 0], [0, img.height - P], [img.width - P, img.height - P]] as const
  let found = 0
  let tile = 0
  for (const [ox, oy] of origins) {
    const s = checkerTile(img, ox, oy, P)
    if (s !== null) {
      found++
      tile = s
    }
  }
  return found >= 2 ? { tileSize: tile, corners: found } : null
}

function checkerTile(img: RgbaImage, ox: number, oy: number, P: number): number | null {
  const d = img.data
  const lum = new Float32Array(P * P)
  let lo = 255, hi = 0
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const i = ((oy + y) * img.width + ox + x) * 4
      if (d[i + 3]! !== 255) return null
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!
      if (Math.max(r, g, b) - Math.min(r, g, b) > 8) return null // not grey
      const l = luma(r, g, b)
      lum[y * P + x] = l
      if (l < lo) lo = l
      if (l > hi) hi = l
    }
  }
  if (hi - lo < 12) return null // one flat colour
  const cls = new Uint8Array(P * P)
  let ones = 0, off = 0
  for (let k = 0; k < lum.length; k++) {
    const l = lum[k]!
    const nearLo = Math.abs(l - lo) <= 6, nearHi = Math.abs(l - hi) <= 6
    if (!nearLo && !nearHi) off++
    cls[k] = nearHi ? 1 : 0
    ones += cls[k]!
  }
  const n = P * P
  if (off > n * 0.03 || ones < n * 0.25 || ones > n * 0.75) return null
  for (let s = 2; s <= P / 2; s++) {
    let ok = 0, total = 0
    for (let y = 0; y + s < P; y++) {
      for (let x = 0; x + s < P; x++) {
        const c = cls[y * P + x]!
        total++
        if (c !== cls[y * P + x + s] && c !== cls[(y + s) * P + x] && c === cls[(y + s) * P + x + s]) ok++
      }
    }
    if (total === 0 || ok / total < 0.6) continue
    // Same class across most horizontal neighbours: tiles are solid, not a 1-pixel dither.
    let same = 0, pairs = 0
    for (let y = 0; y < P; y++) for (let x = 0; x + 1 < P; x++) { pairs++; if (cls[y * P + x] === cls[y * P + x + 1]) same++ }
    if (same / pairs >= 1 - 1.5 / s) return s
  }
  return null
}

/** Rules for web file names: lower case letters, digits and single dashes, at most 60 characters, lower-case extension. */
export function checkName(fileName: string): string[] {
  const dot = fileName.lastIndexOf(".")
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot + 1) : ""
  const problems: string[] = []
  if (/\s/.test(stem)) problems.push("has spaces")
  if (/[A-Z]/.test(stem)) problems.push("has capital letters")
  if (/_/.test(stem)) problems.push("has underscores (use dashes)")
  if (/[^A-Za-z0-9_\s-]/.test(stem)) problems.push("has characters other than letters, digits and dashes")
  if (/^-|-$/.test(stem) || /--/.test(stem)) problems.push("has leading, trailing or doubled dashes")
  if (stem.length > 60) problems.push(`is ${stem.length} characters long (keep it to 60)`)
  if (ext !== ext.toLowerCase()) problems.push("has an upper-case extension")
  return problems
}

/** Turns a file name stem into a web-safe name: "Gearbox Housing_v2" -> "gearbox-housing-v2". */
export function slugify(stem: string): string {
  const s = stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
  return s || "image"
}
