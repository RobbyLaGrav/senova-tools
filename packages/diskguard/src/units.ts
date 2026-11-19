// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Parsing and printing sizes, thresholds and durations. Every parser fails closed: anything it can't read exactly
// throws a DiskguardInputError naming the value, so a typo never turns into "delete everything".

/** Thrown for input diskguard can't read (a bad size, duration, path or option). */
export class DiskguardInputError extends Error {
  override name = "DiskguardInputError"
}

/** A free-space threshold: an absolute number of bytes, or a percentage of the volume's total size. */
export type Threshold = { bytes: number } | { percent: number }

const UNITS: Record<string, number> = {
  "": 1,
  b: 1,
  k: 1e3, kb: 1e3, m: 1e6, mb: 1e6, g: 1e9, gb: 1e9, t: 1e12, tb: 1e12,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
}

/**
 * Parses a size such as `512MB`, `20GB`, `1.5 TB`, `20GiB` or `1048576` (bytes) into bytes.
 * KB, MB, GB, TB (and K, M, G, T) are decimal (1000); KiB, MiB, GiB, TiB are binary (1024).
 */
export function parseSize(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) throw new DiskguardInputError(`size must be a number of bytes, 0 or more; got ${input}`)
    return Math.floor(input)
  }
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(input)
  const unit = m?.[2]?.toLowerCase()
  if (!m || unit === undefined || !(unit in UNITS)) {
    throw new DiskguardInputError(`can't read size "${input}"; use a number with an optional unit, e.g. 500MB, 20GB, 1.5TB or 20GiB`)
  }
  const bytes = Math.floor(Number(m[1]) * UNITS[unit]!)
  if (!Number.isSafeInteger(bytes)) throw new DiskguardInputError(`size "${input}" is too large`)
  return bytes
}

/** Parses a threshold: a size (`20GB`) or a percentage of the volume (`10%`, between 0 and 100). */
export function parseThreshold(input: string | Threshold): Threshold {
  if (typeof input !== "string") {
    if ("percent" in input) return { percent: checkPercent(input.percent, String(input.percent)) }
    return { bytes: parseSize(input.bytes) }
  }
  const m = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(input)
  if (m) return { percent: checkPercent(Number(m[1]), input) }
  return { bytes: parseSize(input) }
}

function checkPercent(p: number, raw: string): number {
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new DiskguardInputError(`percentage "${raw}" must be between 0 and 100`)
  return p
}

/** The number of free bytes a threshold asks for on a volume of `total` bytes. */
export function thresholdBytes(t: Threshold, total: number): number {
  return "bytes" in t ? t.bytes : Math.ceil((t.percent / 100) * total)
}

/** Prints a threshold the way a person would type it. */
export function formatThreshold(t: Threshold): string {
  return "bytes" in t ? formatBytes(t.bytes) : `${t.percent}%`
}

const DURATIONS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000 }

/** Parses a duration with a unit: `500ms`, `30s`, `10m`, `2h`, `1d`. A bare number is refused (seconds or minutes?). */
export function parseDuration(input: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|min|h|d)\s*$/i.exec(input)
  if (!m) throw new DiskguardInputError(`can't read duration "${input}"; use a number with a unit: ms, s, m, h or d (e.g. 30s, 10m)`)
  return Math.round(Number(m[1]) * DURATIONS[m[2]!.toLowerCase()]!)
}

/** Prints bytes in decimal units with three significant figures: `1.23 GB`, `512 MB`, `0 B`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ["kB", "MB", "GB", "TB", "PB"]
  let v = bytes
  let i = -1
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`
}

/** Parses a whole number written in base 10 (no signs, decimals or exponents). `what` names it in the error. */
export function parseInt10(input: string, what: string): number {
  if (!/^\s*\d+\s*$/.test(input)) throw new DiskguardInputError(`${what} must be a whole number; got "${input}"`)
  return Number(input)
}
