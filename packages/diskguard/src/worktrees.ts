// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Finds git worktrees under the roots: a folder scan for `.git` files and folders (never following symlinks or
// junctions), plus `git worktree list --porcelain` from each repository found, which also finds linked worktrees
// that live elsewhere under the roots. Each worktree is checked for signs that it is in use.
import { existsSync, realpathSync } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"

import { git } from "./git.ts"
import { containingRoot } from "./safety.ts"

/** Folders the scan never walks into: they are large and never hold a worktree we should manage. */
const NO_DESCEND = new Set([".git", "node_modules", ".next", ".turbo", ".cache", "dist", "build", "out", "target", "__pycache__", ".pytest_cache", ".parcel-cache", "coverage", ".venv", "venv"])

/** Files that mean "something is using this worktree right now", relative to the worktree. */
export const IN_USE_MARKERS: readonly string[] = [
  // Your own opt-out: create this file in a worktree and diskguard will never clear it.
  ".diskguard-keep",
  // The lock file a Next.js 16 dev server keeps while it runs.
  ".next/dev/lock",
]

export interface Worktree {
  /** Real path of the worktree folder. */
  path: string
  /** The root (real path) it was found under. */
  root: string
  /** Short branch name, or undefined for a detached HEAD. */
  branch: string | undefined
  /** Commit hash at HEAD, if git could read it. */
  head: string | undefined
  /** True for a repository's main worktree, false for one added with `git worktree add`. */
  main: boolean
  /** Unix time (seconds) of the last commit on HEAD, used for "oldest branches first". */
  lastCommit: number | undefined
  /** Why this worktree must not be cleared right now (empty when it is free to clear). */
  inUse: string[]
  /** Set when git could not read this folder; its caches can't be checked against .gitignore and are skipped. */
  gitError: string | undefined
}

export interface FindWorktreesOptions {
  /** How many folder levels below each root to look for `.git` (default 6). */
  depth?: number
  /** Collects folders that couldn't be read. */
  warnings?: string[]
}

interface PorcelainEntry {
  path: string
  head?: string
  branch?: string
  bare: boolean
  locked?: string
  main: boolean
}

/** Parses `git worktree list --porcelain` output. The first entry is the main worktree. */
export function parseWorktreePorcelain(text: string, cwd: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = []
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const lines = block.split("\n").filter((l) => l !== "")
    const first = lines[0]
    if (first === undefined || !first.startsWith("worktree ")) continue
    const raw = first.slice("worktree ".length)
    const e: PorcelainEntry = { path: isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw), bare: false, main: entries.length === 0 }
    for (const l of lines.slice(1)) {
      if (l.startsWith("HEAD ")) e.head = l.slice(5)
      else if (l.startsWith("branch ")) e.branch = l.slice(7).replace(/^refs\/heads\//, "")
      else if (l === "bare") e.bare = true
      else if (l === "locked") e.locked = ""
      else if (l.startsWith("locked ")) e.locked = l.slice(7)
    }
    entries.push(e)
  }
  return entries
}

/** Folders under `root` (real path) that contain a `.git` file or folder, up to `depth` levels down. */
async function scanForRepos(root: string, depth: number, warnings: string[]): Promise<string[]> {
  const found: string[] = []
  const queue: Array<[string, number]> = [[root, 0]]
  while (queue.length > 0) {
    const [dir, level] = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      warnings.push(`couldn't read ${dir}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`)
      continue
    }
    if (entries.some((e) => e.name === ".git" && (e.isDirectory() || e.isFile()))) found.push(dir)
    if (level >= depth) continue
    for (const e of entries) {
      // isDirectory() is false for symlinks and Windows junctions, so the scan never leaves the real tree.
      if (e.isDirectory() && !NO_DESCEND.has(e.name)) queue.push([join(dir, e.name), level + 1])
    }
  }
  return found
}

/** Finds every git worktree under the roots (real paths from checkRoot), sorted by path. */
export async function findWorktrees(roots: readonly string[], opts: FindWorktreesOptions = {}): Promise<Worktree[]> {
  const depth = opts.depth ?? 6
  const warnings = opts.warnings ?? []
  const byPath = new Map<string, { path: string; entry: PorcelainEntry | undefined; root: string; gitError?: string }>()
  const key = (p: string) => (process.platform === "win32" || process.platform === "darwin" ? p.toLowerCase() : p)

  for (const root of roots) {
    for (const dir of await scanForRepos(root, depth, warnings)) {
      if (!byPath.has(key(dir))) byPath.set(key(dir), { path: dir, entry: undefined, root })
      let listed
      try {
        listed = await git(dir, ["worktree", "list", "--porcelain"])
      } catch (err) {
        byPath.get(key(dir))!.gitError = `git could not run: ${(err as Error).message}`
        continue
      }
      if (listed.code !== 0) {
        byPath.get(key(dir))!.gitError = listed.stderr.trim() || `git worktree list exited ${listed.code}`
        continue
      }
      for (const e of parseWorktreePorcelain(listed.stdout, dir)) {
        if (e.bare || !existsSync(e.path)) continue
        const real = realOr(e.path)
        // A worktree that is a root itself is fine; one outside every root is not ours to touch.
        const r = containingRoot(real, roots) ?? roots.find((x) => key(x) === key(real))
        if (r === undefined) continue
        const prev = byPath.get(key(real))
        byPath.set(key(real), { path: real, entry: e, root: prev?.root ?? r, ...(prev?.gitError !== undefined ? { gitError: prev.gitError } : {}) })
      }
    }
  }

  const out: Worktree[] = []
  for (const v of byPath.values()) out.push(await describe(v.entry, v.path, v.root, v.gitError))
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

function realOr(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

async function describe(entry: PorcelainEntry | undefined, path: string, root: string, gitError: string | undefined): Promise<Worktree> {
  const inUse: string[] = []
  if (entry?.locked !== undefined) inUse.push(`locked with git worktree lock${entry.locked ? `: ${entry.locked}` : ""}`)
  for (const m of IN_USE_MARKERS) if (await exists(join(path, m))) inUse.push(`has ${m}`)

  let lastCommit: number | undefined
  if (gitError === undefined) {
    const gitDir = await git(path, ["rev-parse", "--absolute-git-dir"]).catch(() => undefined)
    if (gitDir?.code === 0) {
      const dir = gitDir.stdout.trim()
      if (await exists(join(dir, "index.lock"))) inUse.push("a git command is running (index.lock)")
    }
    const log = await git(path, ["log", "-1", "--format=%ct"]).catch(() => undefined)
    const t = Number(log?.stdout.trim())
    if (log?.code === 0 && Number.isFinite(t) && t > 0) lastCommit = t
  }
  return {
    path,
    root,
    branch: entry?.branch,
    head: entry?.head,
    main: entry?.main ?? true,
    lastCommit,
    inUse,
    gitError,
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}
