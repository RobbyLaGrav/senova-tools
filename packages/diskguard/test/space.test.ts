// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { checkSpace, DiskguardInputError, getFreeSpace, levelOf, watchFreeSpace, type SpaceChange, type SpaceInfo } from "../src/index.ts"

const info = (free: number, total = 1000): SpaceInfo => ({ path: "/x", free, total, freePercent: (free / total) * 100 })

test("getFreeSpace reads the temp folder's volume with fs.statfs", async () => {
  const s = await getFreeSpace(tmpdir())
  assert.ok(s.total > 0, "total")
  assert.ok(s.free >= 0 && s.free <= s.total, "free within total")
  assert.ok(s.freePercent >= 0 && s.freePercent <= 100)
})

test("getFreeSpace fails on a path that does not exist", async () => {
  await assert.rejects(getFreeSpace(join(tmpdir(), "diskguard-no-such-folder-" + process.pid)), /ENOENT/)
})

test("levelOf grades against bytes and percent thresholds", () => {
  const t = { warn: { percent: 20 }, critical: { bytes: 50 } }
  assert.equal(levelOf(info(500), t), "ok")
  assert.equal(levelOf(info(200), t), "warn")
  assert.equal(levelOf(info(50), t), "critical")
  assert.equal(levelOf(info(0), {}), "ok")
})

test("checkSpace needs at least one path and readable thresholds", async () => {
  await assert.rejects(checkSpace([]), DiskguardInputError)
  await assert.rejects(checkSpace(["/x"], { warn: "plenty" }, async () => info(5)), /can't read size "plenty"/)
  const [s] = await checkSpace(["/x"], { warn: "30%", critical: "100B" }, async () => info(200))
  assert.equal(s!.level, "warn")
})

test("watchFreeSpace reports only crossings and stops when aborted", async () => {
  const readings = [500, 480, 150, 140, 30, 600, 600]
  let i = 0
  const stop = new AbortController()
  const seen: SpaceChange[] = []
  await watchFreeSpace(["/x"], {
    warn: { bytes: 200 },
    critical: { bytes: 50 },
    interval: 100,
    signal: stop.signal,
    read: async () => {
      const r = info(readings[Math.min(i, readings.length - 1)]!)
      if (++i >= readings.length) stop.abort()
      return r
    },
    onChange: (c) => seen.push(c),
  })
  assert.deepEqual(seen.map((c) => [c.previous, c.status.level]), [[undefined, "ok"], ["ok", "warn"], ["warn", "critical"], ["critical", "ok"]])
})

test("watchFreeSpace keeps going after a failed reading and refuses bad intervals", async () => {
  const stop = new AbortController()
  const errors: string[] = []
  let n = 0
  await watchFreeSpace(["/x"], {
    warn: { bytes: 1 },
    interval: "100ms",
    signal: stop.signal,
    read: async () => {
      if (++n >= 2) stop.abort()
      throw new Error("unplugged")
    },
    onChange: () => {},
    onError: (e) => errors.push(e.message),
  })
  assert.deepEqual(errors, ["unplugged", "unplugged"])
  await assert.rejects(watchFreeSpace(["/x"], { interval: 5, onChange: () => {} }), DiskguardInputError)
  await assert.rejects(watchFreeSpace(["/x"], { interval: "soon", onChange: () => {} }), DiskguardInputError)
  await assert.rejects(watchFreeSpace([], { onChange: () => {} }), DiskguardInputError)
})
