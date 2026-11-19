// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// scan(): every worktree under the roots and its cache folders, each marked clearable or skipped with a reason.
// clean(): clears the clearable ones (dry run unless `yes`), biggest or oldest branch first, stopping at a target.
import { lstat } from "node:fs/promises"

import { findCaches, key, type CacheFolder } from "./caches.ts"
import { removeTree } from "./remove.ts"
import { checkRoot, containingRoot } from "./safety.ts"
import { getFreeSpace, type SpaceReader } from "./space.ts"
import { DiskguardInputError, parseDuration, parseThreshold, thresholdBytes, type Threshold } from "./units.ts"
import { findWorktrees, type Worktree } from "./worktrees.ts"

export interface ScanOptions {
  /** Offer whole node_modules folders (default false: only node_modules/.cache). */
  includeNodeModules?: boolean
  /** Skip folders with anything modified more recently than this: ms, or a duration like "10m" (default 10 minutes). */
  minAge?: number | string
  /** Folder levels below each root to look for worktrees (default 6). */
  depth?: number
  /** The time to measure ages against (default now). */
  now?: number
  /** Home folder for the root check (default os.homedir()). */
  home?: string
}

export interface ScanResult {
  /** Real paths of the roots. */
  roots: string[]
  worktrees: Worktree[]
  /** Every cache folder found; `skip` is undefined for the ones clean() may clear. */
  caches: CacheFolder[]
  /** Bytes in clearable caches (single-link files only). */
  clearableBytes: number
  /** Folders that couldn't be read. */
  warnings: string[]
}

function minAgeMs(v: number | string | undefined): number {
  if (v === undefined) return 10 * 60_000
  const ms = typeof v === "string" ? parseDuration(v) : v
  if (!Number.isFinite(ms) || ms < 0) throw new DiskguardInputError(`minimum age must be 0 or more; got ${v}`)
  return ms
}

/** Finds worktrees under the roots and their cache folders. Reads only; deletes nothing. */
export async function scan(rootPaths: readonly string[], opts: ScanOptions = {}): Promise<ScanResult> {
  if (rootPaths.length === 0) throw new DiskguardInputError("give at least one root folder to scan")
  const ageMs = minAgeMs(opts.minAge)
  if (opts.depth !== undefined && (!Number.isInteger(opts.depth) || opts.depth < 0 || opts.depth > 50)) {
    throw new DiskguardInputError(`depth must be a whole number from 0 to 50; got ${opts.depth}`)
  }
  const roots = [...new Set(rootPaths.map((r) => checkRoot(r, opts.home)))]
  const now = opts.now ?? Date.now()
  const warnings: string[] = []
  const worktrees = await findWorktrees(roots, { ...(opts.depth !== undefined ? { depth: opts.depth } : {}), warnings })
  const all = new Set(worktrees.map((w) => key(w.path)))
  const caches: CacheFolder[] = []
  for (const wt of worktrees) {
    const others = new Set([...all].filter((p) => p !== key(wt.path)))
    for (const c of await findCaches(wt, { includeNodeModules: opts.includeNodeModules ?? false, otherWorktrees: others })) {
      if (c.skip === undefined && wt.inUse.length > 0) c.skip = `worktree in use: ${wt.inUse.join("; ")}`
      if (c.skip === undefined && containingRoot(c.path, roots) === undefined) c.skip = "its real location is outside the roots"
      if (c.skip === undefined && now - c.newestMs < ageMs) {
        c.skip = `changed ${Math.max(0, Math.round((now - c.newestMs) / 60_000))} min ago (newer than ${Math.round(ageMs / 60_000)} min)`
      }
      caches.push(c)
    }
  }
  const clearableBytes = caches.reduce((n, c) => n + (c.skip === undefined ? c.bytes : 0), 0)
  return { roots, worktrees, caches, clearableBytes, warnings }
}

export interface CleanOptions extends ScanOptions {
  /** Actually delete. Without it, clean() is a dry run and only reports what it would delete. */
  yes?: boolean
  /** Stop once the volume holding each root has this much free: bytes, "20GB" or "15%". */
  target?: Threshold | string
  /** Clear worktrees whose last commit is oldest first (default: biggest cache first). */
  oldestFirst?: boolean
  /** Free-space reader (default fs.statfs). */
  read?: SpaceReader
  /** Called after each folder is handled. */
  onAction?: (action: CleanAction) => void
}

export interface CleanAction {
  path: string
  name: string
  worktree: string
  branch: string | undefined
  bytes: number
  /** deleted / would-delete: cleared (or would be, in a dry run). skipped: not clearable. not-needed: the target was
   * already reached. failed: deletion started but hit an error. */
  result: "deleted" | "would-delete" | "skipped" | "not-needed" | "failed"
  reason: string | undefined
}

export interface CleanResult {
  dryRun: boolean
  actions: CleanAction[]
  /** Bytes deleted, or that a dry run would delete. */
  freedBytes: number
  /** Per root: free bytes before, after (projected in a dry run), the target in bytes, and whether it was reached. */
  volumes: Array<{ root: string; freeBefore: number; freeAfter: number; total: number; targetBytes: number | undefined; targetReached: boolean | undefined }>
  scan: ScanResult
}

/**
 * Clears clearable cache folders under the roots. Dry run unless `yes: true`. Before each deletion it re-checks that
 * the folder is still a real folder (not a link) whose real location is inside a root.
 */
export async function clean(rootPaths: readonly string[], opts: CleanOptions = {}): Promise<CleanResult> {
  const target = opts.target === undefined ? undefined : parseThreshold(opts.target)
  const read = opts.read ?? getFreeSpace
  const dryRun = opts.yes !== true
  const result = await scan(rootPaths, opts)
  const byPath = new Map(result.worktrees.map((w) => [key(w.path), w]))
  const wtOf = (c: CacheFolder) => byPath.get(key(c.worktree))

  const volumes = new Map<string, CleanResult["volumes"][number]>()
  for (const root of result.roots) {
    const s = await read(root)
    const targetBytes = target === undefined ? undefined : thresholdBytes(target, s.total)
    volumes.set(root, { root, freeBefore: s.free, freeAfter: s.free, total: s.total, targetBytes, targetReached: targetBytes === undefined ? undefined : s.free >= targetBytes })
  }

  const order = [...result.caches].sort((a, b) => {
    if (opts.oldestFirst) {
      const ta = wtOf(a)?.lastCommit ?? Number.MAX_SAFE_INTEGER
      const tb = wtOf(b)?.lastCommit ?? Number.MAX_SAFE_INTEGER
      if (ta !== tb) return ta - tb
    }
    return b.bytes - a.bytes || a.path.localeCompare(b.path)
  })

  const actions: CleanAction[] = []
  let freedBytes = 0
  for (const c of order) {
    const wt = wtOf(c)
    const base = { path: c.path, name: c.name, worktree: c.worktree, branch: wt?.branch, bytes: c.bytes }
    const push = (a: CleanAction) => {
      actions.push(a)
      opts.onAction?.(a)
    }
    if (c.skip !== undefined) {
      push({ ...base, result: "skipped", reason: c.skip })
      continue
    }
    const root = containingRoot(c.path, result.roots)
    const vol = root === undefined ? undefined : volumes.get(root)
    if (root === undefined || vol === undefined) {
      push({ ...base, result: "skipped", reason: "its real location is outside the roots" })
      continue
    }
    if (vol.targetBytes !== undefined && vol.freeAfter >= vol.targetBytes) {
      vol.targetReached = true
      push({ ...base, result: "not-needed", reason: "free-space target reached" })
      continue
    }
    if (dryRun) {
      vol.freeAfter += c.bytes
      freedBytes += c.bytes
      push({ ...base, result: "would-delete", reason: undefined })
    } else {
      const problem = await recheck(c.path, result.roots)
      if (problem !== undefined) {
        push({ ...base, result: "skipped", reason: problem })
        continue
      }
      try {
        await removeTree(c.path)
        freedBytes += c.bytes
        push({ ...base, result: "deleted", reason: undefined })
      } catch (err) {
        push({ ...base, result: "failed", reason: (err as Error).message })
      }
      try {
        vol.freeAfter = (await read(root)).free
      } catch {
        vol.freeAfter += c.bytes
      }
    }
    if (vol.targetBytes !== undefined && vol.freeAfter >= vol.targetBytes) vol.targetReached = true
  }
  return { dryRun, actions, freedBytes, volumes: [...volumes.values()], scan: result }
}

/** The last check before deleting: still there, still a real folder, still really inside a root. */
async function recheck(path: string, roots: readonly string[]): Promise<string | undefined> {
  const st = await lstat(path).catch(() => undefined)
  if (st === undefined) return "gone before it could be deleted"
  if (st.isSymbolicLink()) return "became a symlink or junction; not followed"
  if (!st.isDirectory()) return "is no longer a folder"
  if (containingRoot(path, roots) === undefined) return "its real location is outside the roots"
  return undefined
}
