// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { acquireBoardLock } from "../src/index.ts"

const dir = mkdtempSync(join(tmpdir(), "bench-lock-"))
after(() => rmSync(dir, { recursive: true, force: true }))

test("a second job is refused while the first holds the board, and gets it after release", async () => {
  const release = await acquireBoardLock("devkit-1", { dir })
  assert.ok(existsSync(join(dir, "bench-devkit-1.lock")))
  await assert.rejects(acquireBoardLock("devkit-1", { dir }), (e: Error & { code: string }) => e.code === "LOCKED" && new RegExp(`pid ${process.pid}`).test(e.message))
  // Other boards are independent.
  const other = await acquireBoardLock("devkit-2", { dir })
  await other()
  await release()
  await release() // twice is harmless
  assert.ok(!existsSync(join(dir, "bench-devkit-1.lock")))
  await (await acquireBoardLock("devkit-1", { dir }))()
})

test("waiting picks the board up as soon as it is released", async () => {
  const release = await acquireBoardLock("waiter", { dir })
  setTimeout(() => void release(), 60)
  const started = Date.now()
  const mine = await acquireBoardLock("waiter", { dir, waitMs: 2000, pollMs: 10 })
  assert.ok(Date.now() - started < 1500)
  await mine()
})

test("a stale lock from a dead process is taken over; a live or recent one is not", async () => {
  const path = join(dir, "bench-stale.lock")
  const old = new Date(Date.now() - 2 * 3_600_000).toISOString()
  // A pid that can't exist on any platform we run on.
  writeFileSync(path, JSON.stringify({ pid: 2 ** 30, startedAt: old }))
  await (await acquireBoardLock("stale", { dir }))()

  // Old but still alive (this process): kept.
  writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: old }))
  await assert.rejects(acquireBoardLock("stale", { dir }), { code: "LOCKED" })
  // Dead but recent: kept, the job may just have started on another machine sharing the folder.
  writeFileSync(path, JSON.stringify({ pid: 2 ** 30, startedAt: new Date().toISOString() }))
  await assert.rejects(acquireBoardLock("stale", { dir }), { code: "LOCKED" })
  // Unreadable: never treated as free.
  writeFileSync(path, "{half")
  await assert.rejects(acquireBoardLock("stale", { dir }), /unknown holder/)
  rmSync(path)
})

test("release leaves a lock that someone else now holds", async () => {
  const release = await acquireBoardLock("taken", { dir })
  const path = join(dir, "bench-taken.lock")
  writeFileSync(path, JSON.stringify({ pid: 12345, startedAt: new Date().toISOString() }))
  await release()
  assert.ok(existsSync(path))
  rmSync(path)
})

test("board names that could escape the lock folder are refused", async () => {
  await assert.rejects(acquireBoardLock("../x", { dir }), { code: "INVALID_ARGUMENT" })
  await assert.rejects(acquireBoardLock("a/b", { dir }), { code: "INVALID_ARGUMENT" })
})
