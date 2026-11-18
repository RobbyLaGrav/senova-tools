// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// SVG path strings for lines: monotone smooth curves (Fritsch-Carlson), steps and filled areas.
// Every coordinate is rounded to 0.01 px so a server render and a browser render print identical markup.

/** An `[x, y]` pair, in data units or in screen pixels depending on context. */
export type Point = readonly [x: number, y: number]

/** One cubic Bézier piece of a curve: start, two control points, end. */
export interface CubicSegment {
  from: Point
  c1: Point
  c2: Point
  to: Point
}

/** Rounds to 0.01, the precision of every coordinate this package prints. Never returns `-0`. */
export function round2(v: number): number {
  const r = Math.round(v * 100) / 100
  return r === 0 ? 0 : r
}

const xy = (p: Point): string => `${round2(p[0])},${round2(p[1])}`

/**
 * Fritsch-Carlson monotone cubic interpolation. Points must be sorted by x.
 *
 * The curve passes through every point, and between two neighbouring points it stays inside their y-range, so a
 * smooth line never shows a peak or dip the data doesn't have. Fewer than two points give no segments.
 */
export function monotoneSegments(points: readonly Point[]): CubicSegment[] {
  const n = points.length
  if (n < 2) return []
  const p = (i: number): Point => points[i] as Point
  // secant slopes between neighbours (a zero-width step counts as flat rather than infinite)
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = p(i + 1)[0] - p(i)[0]
    d.push(dx === 0 ? 0 : (p(i + 1)[1] - p(i)[1]) / dx)
  }
  const sec = (i: number): number => d[i] as number
  // tangents: average of neighbouring secants, zero at a local peak or dip
  const m: number[] = new Array<number>(n).fill(0)
  m[0] = sec(0)
  m[n - 1] = sec(n - 2)
  for (let i = 1; i < n - 1; i++) m[i] = sec(i - 1) * sec(i) <= 0 ? 0 : (sec(i - 1) + sec(i)) / 2
  // limit the tangents so no segment overshoots (the a² + b² ≤ 9 circle of Fritsch and Carlson)
  for (let i = 0; i < n - 1; i++) {
    const di = sec(i)
    if (di === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = (m[i] as number) / di
    const b = (m[i + 1] as number) / di
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      m[i] = t * a * di
      m[i + 1] = t * b * di
    }
  }
  const out: CubicSegment[] = []
  for (let i = 0; i < n - 1; i++) {
    const a = p(i), b = p(i + 1)
    const dx = (b[0] - a[0]) / 3
    out.push({ from: a, c1: [a[0] + dx, a[1] + (m[i] as number) * dx], c2: [b[0] - dx, b[1] - (m[i + 1] as number) * dx], to: b })
  }
  return out
}

/**
 * The SVG path of a monotone smooth line through `points` (sorted by x). Two points give a straight `M…L…` line,
 * one or none give an empty string.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length < 2) return ""
  if (points.length === 2) return `M${xy(points[0] as Point)}L${xy(points[1] as Point)}`
  let s = `M${xy(points[0] as Point)}`
  for (const seg of monotoneSegments(points)) s += `C${xy(seg.c1)} ${xy(seg.c2)} ${xy(seg.to)}`
  return s
}

/** Straight segments between the points. */
export function linearPath(points: readonly Point[]): string {
  if (points.length < 2) return ""
  return points.map((q, i) => `${i === 0 ? "M" : "L"}${xy(q)}`).join("")
}

/** A step line: horizontal to the next x, then vertical to its y (a value that holds until it changes). */
export function stepPath(points: readonly Point[]): string {
  if (points.length < 2) return ""
  return points.map((q, i) => (i === 0 ? `M${xy(q)}` : `H${round2(q[0])}V${round2(q[1])}`)).join("")
}

/** Closes a line path down to a horizontal baseline (screen y) to make a filled area. */
export function areaPath(line: string, points: readonly Point[], baselineY: number): string {
  if (!line || points.length < 2) return ""
  const first = points[0] as Point, last = points[points.length - 1] as Point
  return `${line}L${round2(last[0])},${round2(baselineY)}L${round2(first[0])},${round2(baselineY)}Z`
}

/** How a series is drawn between its points. */
export type Curve = "smooth" | "linear" | "step"

/** The path of a line for the given curve. */
export function linePath(points: readonly Point[], curve: Curve = "smooth"): string {
  if (curve === "step") return stepPath(points)
  if (curve === "linear") return linearPath(points)
  return smoothPath(points)
}
