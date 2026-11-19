// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { measurement, Poller, ProbeError, type Measurement } from "../src/index.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const m = (value: number): Measurement => measurement({ quantity: "voltage", value, instrument: "sim" })

// Timing tests wait for events (ticks, reads) instead of sleeping a fixed time, so a busy machine where timers fire
// late makes them slower, not red. The 5 s limit only catches a poller that has stopped ticking.
async function until(cond: () => boolean, what: string, limitMs = 5000): Promise<void> {
  const end = Date.now() + limitMs
  do {
    await sleep(5)
    if (cond()) return
  } while (Date.now() < end)
  throw new Error(`timed out waiting for ${what}`)
}

test("polls on the interval and delivers every measurement in order", async () => {
  let n = 0
  const got: number[] = []
  const p = new Poller({ intervalMs: 20, read: async () => [m(n++), m(n++)], onMeasurement: (x) => got.push(x.value) }).start()
  await until(() => p.stats.reads >= 4, "four reads")
  await p.stop()
  assert.ok(p.stats.reads >= 4, JSON.stringify(p.stats))
  assert.deepEqual(got, got.map((_, i) => i))
  assert.equal(p.stats.measurements, got.length)
  assert.equal(p.running, false)
})

test("skip: a slow read never overlaps the next one, missed ticks are dropped", async () => {
  let active = 0
  let maxActive = 0
  let first = true
  const p: Poller = new Poller({
    intervalMs: 20,
    overrun: "skip",
    read: async () => {
      maxActive = Math.max(maxActive, ++active)
      // The first read stays slow until four more ticks have arrived while it runs.
      if (first) await until(() => p.stats.ticks >= 5, "ticks during the slow read")
      first = false
      active--
      return m(1)
    },
  }).start()
  await until(() => p.stats.reads >= 2, "a read after the slow one")
  await p.stop()
  assert.equal(maxActive, 1)
  assert.ok(p.stats.skipped >= 4, JSON.stringify(p.stats))
  assert.equal(p.stats.coalesced, 0)
  // Skipped ticks are dropped, not queued: there are fewer reads than ticks.
  assert.ok(p.stats.reads < p.stats.ticks, JSON.stringify(p.stats))
})

test("coalesce: missed ticks fold into one catch-up read straight after the slow one", async () => {
  const starts: number[] = []
  const ends: number[] = []
  // A long interval, so a catch-up read that started on the next tick instead would show up as a big gap.
  const p: Poller = new Poller({
    intervalMs: 100,
    overrun: "coalesce",
    read: async () => {
      starts.push(Date.now())
      // The first read stays slow until three more ticks have arrived while it runs.
      if (starts.length === 1) await until(() => p.stats.ticks >= 4, "ticks during the slow read")
      ends.push(Date.now())
      return m(1)
    },
  }).start()
  await until(() => p.stats.reads >= 2, "the catch-up read")
  await p.stop()
  assert.ok(p.stats.coalesced >= 3, JSON.stringify(p.stats))
  // The second read starts right after the first ends, not on the next tick, and only one catch-up read ran.
  assert.ok(starts[1]! - ends[0]! < 50, `${starts[1]! - ends[0]!} ms gap`)
  assert.equal(p.stats.skipped, 0)
})

test("stop() waits for the read in progress and its delivery", async () => {
  const got: number[] = []
  const p = new Poller({
    intervalMs: 1000,
    read: async () => {
      await sleep(60)
      return m(7)
    },
    onMeasurement: (x) => got.push(x.value),
  }).start()
  await sleep(10)
  await p.stop()
  assert.deepEqual(got, [7])
})

test("errors are reported and polling continues; bad measurements are refused", async () => {
  let n = 0
  const errors: string[] = []
  const got: number[] = []
  const p = new Poller({
    intervalMs: 15,
    read: async () => {
      n++
      if (n === 1) throw new ProbeError("TIMEOUT", "slow")
      if (n === 2) return { quantity: "voltage", value: 1, unit: "mV", t: 1, instrument: "x" } as unknown as Measurement
      return m(n)
    },
    onMeasurement: (x) => got.push(x.value),
    onError: (e) => errors.push(e.message),
  }).start()
  await sleep(80)
  await p.stop()
  assert.equal(errors[0], "slow")
  assert.match(errors[1]!, /must be in V/)
  assert.ok(got.length >= 1 && got[0] === 3)
  assert.equal(p.stats.errors, 2)
  assert.throws(() => new Poller({ intervalMs: 1, read: async () => m(1) }), /intervalMs/)
  assert.throws(() => new Poller({ intervalMs: 50, read: async () => m(1), overrun: "queue" as never }), /overrun/)
})
