// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// One board, one job: an exclusive lock file per board. A lock left behind by a job that crashed is taken over only
// when it is old and its process is gone, so a slow but live job keeps its board.
import { open, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkBoardName } from "./board.ts"
import { BenchError, invalid } from "./errors.ts"

export interface LockOptions {
  /** Default os.tmpdir(). */
  dir?: string
  /** How long to wait for a held lock. Default 0 (fail at once). */
  waitMs?: number
  /** A lock older than this whose process is gone is taken over. Default one hour. */
  staleMs?: number
  /** Time between tries while waiting. Default 250 ms. */
  pollMs?: number
}

interface Holder {
  pid: number
  startedAt: string
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function readHolder(path: string): Promise<Holder | undefined> {
  try {
    const v = JSON.parse(await readFile(path, "utf8")) as Partial<Holder>
    if (typeof v.pid === "number" && typeof v.startedAt === "string") return { pid: v.pid, startedAt: v.startedAt }
  } catch {
    // Unreadable or half-written: treated as unknown, never as free.
  }
  return undefined
}

/** Takes the lock for `name` and returns the function that releases it. Throws `LOCKED` if it stays held. */
export async function acquireBoardLock(name: string, options: LockOptions = {}): Promise<() => Promise<void>> {
  checkBoardName(name)
  const waitMs = options.waitMs ?? 0
  const staleMs = options.staleMs ?? 3_600_000
  const pollMs = options.pollMs ?? 250
  if (!(waitMs >= 0) || !(staleMs > 0) || !(pollMs > 0)) throw invalid("waitMs, staleMs and pollMs must be non-negative numbers")
  const path = join(options.dir ?? tmpdir(), `bench-${name}.lock`)
  const deadline = Date.now() + waitMs
  const me: Holder = { pid: process.pid, startedAt: new Date().toISOString() }

  for (;;) {
    try {
      const handle = await open(path, "wx")
      try {
        await handle.writeFile(JSON.stringify(me))
      } finally {
        await handle.close()
      }
      let released = false
      return async () => {
        if (released) return
        released = true
        const holder = await readHolder(path)
        // Only remove the file if it is still ours.
        if (holder?.pid === me.pid && holder.startedAt === me.startedAt) await rm(path, { force: true })
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw new BenchError("LOCKED", `could not create ${path}: ${(err as Error).message}`, { cause: err })
    }
    const holder = await readHolder(path)
    if (holder && Date.now() - Date.parse(holder.startedAt) > staleMs && !alive(holder.pid)) {
      await rm(path, { force: true })
      continue
    }
    if (Date.now() >= deadline) {
      const who = holder ? `pid ${holder.pid} since ${holder.startedAt}` : "an unknown holder"
      throw new BenchError("LOCKED", `board ${name} is in use by ${who} (${path})`)
    }
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(1, deadline - Date.now()))))
  }
}
