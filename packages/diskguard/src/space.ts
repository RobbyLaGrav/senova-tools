// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Free space on a volume, via fs.statfs, compared against warn and critical thresholds, once or on a timer.
import { statfs } from "node:fs/promises"
import { resolve } from "node:path"

import { DiskguardInputError, parseDuration, thresholdBytes, type Threshold } from "./units.ts"

/** Free space on the volume that holds `path`. */
export interface SpaceInfo {
  path: string
  /** Bytes the current user can write (statfs bavail). */
  free: number
  /** Size of the volume in bytes. */
  total: number
  /** Percentage of the volume that is free, 0 to 100. */
  freePercent: number
}

/** ok: above both thresholds. warn: at or below `warn`. critical: at or below `critical`. */
export type SpaceLevel = "ok" | "warn" | "critical"

export interface Thresholds {
  warn?: Threshold
  critical?: Threshold
}

export interface SpaceStatus extends SpaceInfo {
  level: SpaceLevel
}

/** Reads free space. Tests and callers can pass their own reader in place of fs.statfs. */
export type SpaceReader = (path: string) => Promise<SpaceInfo>

/** Reads free space on the volume holding `path` with fs.statfs. Fails if the path does not exist. */
export async function getFreeSpace(path: string): Promise<SpaceInfo> {
  const abs = resolve(path)
  const s = await statfs(abs)
  const free = Number(s.bavail) * Number(s.bsize)
  const total = Number(s.blocks) * Number(s.bsize)
  return { path: abs, free, total, freePercent: total > 0 ? (free / total) * 100 : 0 }
}

/** The level of one reading against the thresholds. */
export function levelOf(info: SpaceInfo, t: Thresholds): SpaceLevel {
  if (t.critical !== undefined && info.free <= thresholdBytes(t.critical, info.total)) return "critical"
  if (t.warn !== undefined && info.free <= thresholdBytes(t.warn, info.total)) return "warn"
  return "ok"
}

/** Reads every path once and grades it against the thresholds. */
export async function checkSpace(paths: readonly string[], t: Thresholds = {}, read: SpaceReader = getFreeSpace): Promise<SpaceStatus[]> {
  if (paths.length === 0) throw new DiskguardInputError("give at least one path to check")
  const out: SpaceStatus[] = []
  for (const p of paths) {
    const info = await read(p)
    out.push({ ...info, level: levelOf(info, t) })
  }
  return out
}

/** One crossing: a path's level changed (or the first reading, with `previous` undefined). */
export interface SpaceChange {
  status: SpaceStatus
  previous: SpaceLevel | undefined
  at: Date
}

export interface WatchOptions extends Thresholds {
  /** Milliseconds between readings, or a duration such as "30s" (default 60s, at least 100 ms). */
  interval?: number | string
  /** Called on the first reading of each path and every time its level changes. */
  onChange: (change: SpaceChange) => void
  /** Called when a reading fails (for example the drive was unplugged). Watching carries on. */
  onError?: (err: Error, path: string) => void
  /** Stops watching when aborted. */
  signal?: AbortSignal
  read?: SpaceReader
}

/**
 * Polls free space on each path and reports when it crosses a threshold. Resolves when `signal` aborts.
 * Only changes are reported, so a disk sitting below `warn` produces one event, not one per poll.
 */
export async function watchFreeSpace(paths: readonly string[], opts: WatchOptions): Promise<void> {
  if (paths.length === 0) throw new DiskguardInputError("give at least one path to watch")
  const interval = typeof opts.interval === "string" ? parseDuration(opts.interval) : (opts.interval ?? 60_000)
  if (!Number.isFinite(interval) || interval < 100) throw new DiskguardInputError(`watch interval must be at least 100 ms; got ${interval}`)
  const read = opts.read ?? getFreeSpace
  const last = new Map<string, SpaceLevel>()
  const signal = opts.signal
  while (!signal?.aborted) {
    for (const p of paths) {
      try {
        const info = await read(p)
        const status: SpaceStatus = { ...info, level: levelOf(info, opts) }
        const previous = last.get(p)
        if (previous !== status.level) {
          last.set(p, status.level)
          opts.onChange({ status, previous, at: new Date() })
        }
      } catch (err) {
        opts.onError?.(err as Error, p)
      }
    }
    await sleep(interval, signal)
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((done) => {
    if (signal?.aborted) return done()
    const timer = setTimeout(finish, ms)
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", finish)
      done()
    }
    signal?.addEventListener("abort", finish, { once: true })
  })
}
