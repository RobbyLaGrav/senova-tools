// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { BenchError, LineBuffer } from "../src/index.ts"

test("splits chunks into lines, drops \\r and holds a partial line", () => {
  const b = new LineBuffer()
  b.push("boot ")
  assert.deepEqual(b.lines, [])
  b.push("ok\r\nrail 3v3 3.3\npar")
  assert.deepEqual(b.lines, ["boot ok", "rail 3v3 3.3"])
  b.push("tial\n")
  assert.deepEqual(b.tail(1), ["partial"])
  assert.equal(b.mark(), 3)
})

test("keeps at most maxLines and keeps counting indexes", () => {
  const b = new LineBuffer(2)
  b.push("a\nb\nc\n")
  assert.deepEqual(b.lines, ["b", "c"])
  assert.equal(b.mark(), 3)
})

test("a console that never sends a newline is flushed as a line once past 64 KiB", () => {
  const b = new LineBuffer()
  b.push("x".repeat(70000))
  assert.equal(b.lines.length, 1)
  assert.equal(b.lines[0]?.length, 70000)
})

test("waitFor finds a line already there, or one that arrives later", async () => {
  const b = new LineBuffer()
  b.push("boot app ok\n")
  assert.deepEqual(await b.waitFor(/^boot \S+ ok$/), { line: "boot app ok", index: 0 })
  const later = b.waitFor("pong", { since: b.mark() })
  b.push("noise\npong\n")
  assert.deepEqual(await later, { line: "pong", index: 2 })
})

test("waitFor with a string matches the whole line only", async () => {
  const b = new LineBuffer()
  b.push("pong pong\n")
  await assert.rejects(b.waitFor("pong", { timeoutMs: 20 }), (e: BenchError) => e.code === "TIMEOUT" && /"pong"/.test(e.message))
})

test("waitFor ignores lines before since, and a global RegExp keeps no state", async () => {
  const b = new LineBuffer()
  b.push("ready\n")
  const re = /ready/g
  assert.equal((await b.waitFor(re)).index, 0)
  assert.equal((await b.waitFor(re)).index, 0)
  await assert.rejects(b.waitFor(re, { since: 1, timeoutMs: 10 }), { code: "TIMEOUT" })
})

test("waitFor stops on abort", async () => {
  const b = new LineBuffer()
  const c = new AbortController()
  const p = b.waitFor("never", { signal: c.signal })
  c.abort()
  await assert.rejects(p, { code: "CLOSED" })
  await assert.rejects(b.waitFor("never", { signal: c.signal }), { code: "CLOSED" })
})

test("bad arguments are refused", () => {
  assert.throws(() => new LineBuffer(0), { code: "INVALID_ARGUMENT" })
  assert.throws(() => new LineBuffer().waitFor("x", { timeoutMs: -1 }), { code: "INVALID_ARGUMENT" })
  assert.throws(() => new LineBuffer().waitFor(42 as unknown as string), { code: "INVALID_ARGUMENT" })
})
