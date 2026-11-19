// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Finds cache folders inside a worktree from a fixed allowlist, measures them without following links, and asks git
// whether each one is ignored and untracked. A folder git doesn't ignore is not treated as a cache, whatever its name.
import { lstat, readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"

import { git } from "./git.ts"
import type { Worktree } from "./worktrees.ts"

/** Folder names diskguard treats as rebuildable caches. Anything else is never a candidate. */
export const CACHE_NAMES: readonly string[] = [
  ".next", ".turbo", "dist", "build", "out", "target", ".parcel-cache", "coverage", "__pycache__", ".pytest_cache",
]

/** Cache folders that live inside node_modules (offered without the --node-modules flag). */
export const NODE_MODULES_CACHES: readonly string[] = ["node_modules/.cache"]

export interface DirSize {
  /** Bytes in files with a single hard link: what deleting the folder frees. */
  bytes: number
  /** Bytes in files that have other hard links (pnpm stores, for example): deleting may free nothing. */
  sharedBytes: number
  files: number
  /** Newest modification time (ms) of the folder or anything in it. */
  newestMs: number
  /** Symlinks and junctions inside, counted but never followed. */
  links: number
}

/**
 * Measures a folder with lstat only: symlinks and Windows junctions are counted as links and never followed, and a
 * file with several hard links is counted once, as shared.
 */
export async function measureDir(path: string): Promise<DirSize> {
  const seen = new Set<string>()
  const size: DirSize = { bytes: 0, sharedBytes: 0, files: 0, newestMs: 0, links: 0 }
  const stack = [path]
  while (stack.length > 0) {
    const p = stack.pop()!
    let st
    try {
      st = await lstat(p, { bigint: true })
    } catch {
      continue // vanished while we looked
    }
    const mtime = Number(st.mtimeMs)
    if (mtime > size.newestMs) size.newestMs = mtime
    if (st.isSymbolicLink()) {
      size.links++
    } else if (st.isDirectory()) {
      let names: string[]
      try {
        names = await readdir(p)
      } catch {
        continue
      }
      for (const n of names) stack.push(join(p, n))
    } else {
      size.files++
      if (st.nlink > 1n) {
        const id = `${st.dev}:${st.ino}`
        if (!seen.has(id)) {
          seen.add(id)
          size.sharedBytes += Number(st.size)
        }
      } else size.bytes += Number(st.size)
    }
  }
  return size
}

export interface CacheFolder extends DirSize {
  /** Absolute path of the cache folder. */
  path: string
  /** Path relative to its worktree, with forward slashes (`.next`, `apps/web/.next`, `node_modules/.cache`). */
  name: string
  /** The worktree it belongs to. */
  worktree: string
  /** Why it won't be cleared, or undefined if it may be. */
  skip: string | undefined
}

export interface FindCachesOptions {
  /** Offer whole node_modules folders too (default false: only node_modules/.cache). */
  includeNodeModules?: boolean
  /** Levels below the worktree to look for caches (default 6, for monorepos: apps/web/.next). */
  depth?: number
  /** Other worktrees' paths: never walked into from this one. */
  otherWorktrees?: ReadonlySet<string>
}

interface Candidate {
  path: string
  name: string
  link: boolean
}

async function findCandidates(wt: string, opts: FindCachesOptions): Promise<Candidate[]> {
  const names = new Set(CACHE_NAMES)
  const out: Candidate[] = []
  const depth = opts.depth ?? 6
  const others = opts.otherWorktrees ?? new Set<string>()
  const queue: Array<[string, number]> = [[wt, 0]]
  const rel = (p: string) => relative(wt, p).split(sep).join("/")
  while (queue.length > 0) {
    const [dir, level] = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    if (dir !== wt && entries.some((e) => e.name === ".git")) continue // a nested repository or worktree
    for (const e of entries) {
      const p = join(dir, e.name)
      const link = e.isSymbolicLink()
      if (e.name === ".git" || (!e.isDirectory() && !link)) continue
      if (e.name === "node_modules") {
        if (opts.includeNodeModules) out.push({ path: p, name: rel(p), link })
        else if (!link) {
          const inner = join(p, ".cache")
          const st = await lstat(inner).catch(() => undefined)
          if (st && (st.isDirectory() || st.isSymbolicLink())) out.push({ path: inner, name: rel(inner), link: st.isSymbolicLink() })
        }
        continue
      }
      if (names.has(e.name)) {
        out.push({ path: p, name: rel(p), link })
        continue
      }
      if (!link && level + 1 < depth && !others.has(key(p))) queue.push([p, level + 1])
    }
  }
  return out
}

export const key = (p: string) => (process.platform === "win32" || process.platform === "darwin" ? p.toLowerCase() : p)

/**
 * Finds and measures the cache folders in one worktree. Each gets `skip` set when it must not be cleared: it is a
 * link, git doesn't ignore it, or it holds tracked files. Worktree-level and age checks are added by the caller.
 */
export async function findCaches(wt: Worktree, opts: FindCachesOptions = {}): Promise<CacheFolder[]> {
  const candidates = await findCandidates(wt.path, opts)
  if (candidates.length === 0) return []
  const ignored = new Set<string>()
  const tracked = new Set<string>()
  let gitProblem = wt.gitError
  if (gitProblem === undefined) {
    const names = candidates.filter((c) => !c.link).map((c) => c.name)
    if (names.length > 0) {
      try {
        // --no-index: answer from the ignore rules alone, so a tracked folder still reports as ignored or not; the
        // ls-files check below catches tracked content separately.
        const ci = await git(wt.path, ["check-ignore", "--no-index", "--stdin"], names.join("\n") + "\n")
        if (ci.code === 0 || ci.code === 1) {
          for (const l of ci.stdout.split(/\r?\n/)) if (l) ignored.add(l.replace(/\/$/, ""))
        } else gitProblem = ci.stderr.trim() || `git check-ignore exited ${ci.code}`
        const ls = await git(wt.path, ["ls-files", "-z", "--", ...names.map((n) => `:(literal)${n}`)])
        if (ls.code === 0) {
          for (const f of ls.stdout.split("\0")) if (f) {
            const owner = names.find((n) => f === n || f.startsWith(n + "/"))
            if (owner !== undefined) tracked.add(owner)
          }
        } else gitProblem = ls.stderr.trim() || `git ls-files exited ${ls.code}`
      } catch (err) {
        gitProblem = `git could not run: ${(err as Error).message}`
      }
    }
  }

  const out: CacheFolder[] = []
  for (const c of candidates) {
    const size: DirSize = c.link ? { bytes: 0, sharedBytes: 0, files: 0, newestMs: 0, links: 1 } : await measureDir(c.path)
    let skip: string | undefined
    if (c.link) skip = "is a symlink or junction (never followed or cleared)"
    else if (gitProblem !== undefined) skip = `git couldn't confirm it is ignored (${gitProblem})`
    else if (tracked.has(c.name)) skip = "holds files tracked by git"
    else if (!ignored.has(c.name)) skip = "not ignored by git, so it may be source, not a cache"
    out.push({ ...size, path: c.path, name: c.name, worktree: wt.path, skip })
  }
  return out
}
