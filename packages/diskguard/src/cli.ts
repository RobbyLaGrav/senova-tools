// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { parseArgs } from "node:util"
import { relative, resolve } from "node:path"

import { clean, scan, type CleanAction } from "./clean.ts"
import { checkSpace, watchFreeSpace, type SpaceReader, type SpaceStatus, type Thresholds } from "./space.ts"
import { DiskguardInputError, formatBytes, formatThreshold, parseInt10, parseThreshold } from "./units.ts"

export const USAGE = `diskguard: watch disk space and clear build caches across git worktrees (dry run by default).

Usage:
  diskguard status [paths...]          free space on the volume holding each path (default: this folder)
  diskguard watch [paths...]           keep checking; print a line each time a path crosses a threshold
  diskguard scan <roots...>            list worktrees under the roots and their cache folders
  diskguard clean <roots...>           show what would be cleared; add --yes to delete

Options:
      --warn <size|%>         status/watch: warn at or below this much free (e.g. 20GB or 10%)
      --critical <size|%>     status/watch: critical at or below this much free
      --interval <duration>   watch: time between checks (default 60s)
      --yes                   clean: really delete (without it nothing is deleted)
      --target <size|%>       clean: stop once each root's volume has this much free (e.g. 20GB)
      --oldest-first          clean: clear worktrees with the oldest last commit first (default: biggest first)
      --node-modules          scan/clean: offer whole node_modules folders too (default: only node_modules/.cache)
      --min-age <duration>    scan/clean: skip folders changed more recently than this (default 10m)
      --depth <n>             scan/clean: folder levels below each root to look for worktrees (default 6)
      --json                  print JSON (watch: one JSON object per line)
  -h, --help                  this help

Exit codes: 0 fine, 1 a check found low space (status) or a deletion failed (clean), 2 bad input.`

/** Where the CLI writes. Tests pass their own. */
export interface CliIo {
  stdout(line: string): void
  stderr(line: string): void
  cwd: string
  /** Free-space reader (tests pass a fake). */
  read?: SpaceReader
  home?: string
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(line + "\n"),
  stderr: (line) => process.stderr.write(line + "\n"),
  cwd: process.cwd(),
}

/** Runs the CLI with the given arguments (without `node` and the script) and returns the exit code. */
export async function main(argv: readonly string[], io: CliIo = defaultIo, signal?: AbortSignal): Promise<number> {
  let args
  try {
    args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        warn: { type: "string" },
        critical: { type: "string" },
        interval: { type: "string" },
        yes: { type: "boolean" },
        target: { type: "string" },
        "oldest-first": { type: "boolean" },
        "node-modules": { type: "boolean" },
        "min-age": { type: "string" },
        depth: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    })
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }
  const { values: v, positionals } = args
  const [command, ...rest] = positionals
  if (v.help || command === undefined || command === "help") {
    io.stdout(USAGE)
    return v.help || command === "help" ? 0 : 2
  }
  const paths = rest.map((p) => resolve(io.cwd, p))
  const show = (p: string) => {
    const rel = relative(io.cwd, p)
    return rel === "" ? "." : rel.startsWith("..") ? p : rel
  }
  const json = (x: unknown) => io.stdout(JSON.stringify(x, null, 2))
  const read = io.read
  try {
    const only = (allowed: string[]) => {
      const all = ["warn", "critical", "interval", "yes", "target", "oldest-first", "node-modules", "min-age", "depth"]
      for (const o of all) if ((v as Record<string, unknown>)[o] !== undefined && !allowed.includes(o)) throw new DiskguardInputError(`--${o} does not apply to "${command}"`)
    }
    const thresholds = (): Thresholds => ({
      ...(v.warn !== undefined ? { warn: parseThreshold(v.warn) } : {}),
      ...(v.critical !== undefined ? { critical: parseThreshold(v.critical) } : {}),
    })
    const scanOpts = () => ({
      includeNodeModules: v["node-modules"] ?? false,
      ...(v["min-age"] !== undefined ? { minAge: v["min-age"] } : {}),
      ...(v.depth !== undefined ? { depth: parseInt10(v.depth, "--depth") } : {}),
      ...(io.home !== undefined ? { home: io.home } : {}),
    })
    const needRoots = () => {
      if (paths.length === 0) throw new DiskguardInputError(`name the root folders to ${command}, e.g. diskguard ${command} ~/code`)
    }

    switch (command) {
      case "status": {
        only(["warn", "critical"])
        const t = thresholds()
        const list = await checkSpace(paths.length > 0 ? paths : [io.cwd], t, read)
        if (v.json) json({ thresholds: describeThresholds(t), paths: list })
        else for (const s of list) io.stdout(statusLine(s, show))
        return list.some((s) => s.level !== "ok") ? 1 : 0
      }
      case "watch": {
        only(["warn", "critical", "interval"])
        const t = thresholds()
        if (t.warn === undefined && t.critical === undefined) throw new DiskguardInputError("watch needs --warn and/or --critical")
        await watchFreeSpace(paths.length > 0 ? paths : [io.cwd], {
          ...t,
          interval: v.interval ?? "60s",
          ...(read !== undefined ? { read } : {}),
          ...(signal !== undefined ? { signal } : {}),
          onChange: (c) => {
            if (v.json) io.stdout(JSON.stringify({ at: c.at.toISOString(), previous: c.previous ?? null, ...c.status }))
            else io.stdout(`${c.at.toISOString()}  ${statusLine(c.status, show)}${c.previous !== undefined ? `  (was ${c.previous})` : ""}`)
          },
          onError: (err, p) => io.stderr(`diskguard: couldn't read ${show(p)}: ${err.message}`),
        })
        return 0
      }
      case "scan": {
        only(["node-modules", "min-age", "depth"])
        needRoots()
        const r = await scan(paths, scanOpts())
        if (v.json) {
          json(r)
          return 0
        }
        for (const w of r.warnings) io.stderr(`diskguard: ${w}`)
        for (const wt of r.worktrees) {
          io.stdout(`${show(wt.path)}  ${wt.branch ?? "(detached)"}${wt.main ? "" : "  [linked]"}${wt.lastCommit ? `  last commit ${new Date(wt.lastCommit * 1000).toISOString().slice(0, 10)}` : ""}`)
          if (wt.inUse.length > 0) io.stdout(`    in use: ${wt.inUse.join("; ")}`)
          for (const c of r.caches.filter((c) => c.worktree === wt.path)) io.stdout(`    ${formatBytes(c.bytes).padStart(9)}  ${c.name}${c.skip ? `  (skip: ${c.skip})` : ""}`)
        }
        io.stdout(`${r.worktrees.length} worktree(s), ${r.caches.length} cache folder(s), ${formatBytes(r.clearableBytes)} clearable`)
        return 0
      }
      case "clean": {
        only(["yes", "target", "oldest-first", "node-modules", "min-age", "depth"])
        needRoots()
        const r = await clean(paths, {
          ...scanOpts(),
          yes: v.yes ?? false,
          oldestFirst: v["oldest-first"] ?? false,
          ...(v.target !== undefined ? { target: v.target } : {}),
          ...(read !== undefined ? { read } : {}),
          ...(v.json ? {} : { onAction: (a: CleanAction) => io.stdout(actionLine(a, show)) }),
        })
        const failed = r.actions.some((a) => a.result === "failed")
        if (v.json) {
          json(r)
          return failed ? 1 : 0
        }
        for (const vol of r.volumes) {
          const tgt = vol.targetBytes === undefined ? "" : `, target ${formatBytes(vol.targetBytes)} ${vol.targetReached ? "reached" : "not reached"}`
          io.stdout(`${show(vol.root)}: free ${formatBytes(vol.freeBefore)} -> ${formatBytes(vol.freeAfter)}${r.dryRun ? " (projected)" : ""}${tgt}`)
        }
        io.stdout(r.dryRun
          ? `dry run: would free ${formatBytes(r.freedBytes)}. Nothing was deleted; add --yes to delete.`
          : `freed ${formatBytes(r.freedBytes)}${failed ? "; some folders failed, see above" : ""}`)
        return failed ? 1 : 0
      }
      default:
        throw new DiskguardInputError(`unknown command "${command}"`)
    }
  } catch (err) {
    if (err instanceof DiskguardInputError) {
      io.stderr(`diskguard: ${err.message}`)
      return 2
    }
    io.stderr(`diskguard: ${(err as Error).message}`)
    return 1
  }
}

function describeThresholds(t: Thresholds) {
  const f = (x: Thresholds["warn"]) => (x === undefined ? null : formatThreshold(parseThreshold(x)))
  return { warn: f(t.warn), critical: f(t.critical) }
}

function statusLine(s: SpaceStatus, show: (p: string) => string): string {
  return `${s.level.toUpperCase().padEnd(8)} ${show(s.path)}  ${formatBytes(s.free)} free of ${formatBytes(s.total)} (${s.freePercent.toFixed(1)}%)`
}

function actionLine(a: CleanAction, show: (p: string) => string): string {
  const label = { deleted: "deleted", "would-delete": "would delete", skipped: "skip", "not-needed": "not needed", failed: "FAILED" }[a.result]
  return `${label.padEnd(12)} ${formatBytes(a.bytes).padStart(9)}  ${show(a.path)}${a.branch ? `  [${a.branch}]` : ""}${a.reason ? `  (${a.reason})` : ""}`
}
