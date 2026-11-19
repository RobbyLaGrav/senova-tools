// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example, on a throwaway workspace in the temp folder: a repository with a linked worktree
// and some build caches. Run it from the repository root:
//   node packages/diskguard/examples/dry-run.ts
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { checkSpace, clean, formatBytes } from "../src/index.ts"

const code = realpathSync(mkdtempSync(join(tmpdir(), "diskguard-example-")))
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=example", "-c", "user.email=example@invalid", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "ignore" })
const put = (path: string, bytes: number) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "x".repeat(bytes))
}

try {
  const app = join(code, "app")
  mkdirSync(app)
  git(app, "init", "-q", "-b", "main")
  writeFileSync(join(app, ".gitignore"), ".next/\nnode_modules/\ndist/\n")
  put(join(app, "src", "index.ts"), 100)
  git(app, "add", "-A")
  git(app, "commit", "-q", "-m", "first")
  git(app, "worktree", "add", "-q", "-b", "feature", join(code, "app-feature"))
  put(join(app, ".next", "cache", "webpack.bin"), 300_000)
  put(join(app, "node_modules", ".cache", "babel.bin"), 120_000)
  put(join(code, "app-feature", "dist", "bundle.js"), 80_000)

  const [disk] = await checkSpace([code], { warn: "10%" })
  console.log(`free: ${formatBytes(disk!.free)} of ${formatBytes(disk!.total)} (${disk!.level})`)

  // minAge 0 because this example just wrote its caches; the default skips anything changed in the last 10 minutes.
  const plan = await clean([code], { minAge: 0 })
  for (const a of plan.actions) console.log(`${a.result.padEnd(12)} ${formatBytes(a.bytes).padStart(9)}  ${a.name}  [${a.branch}]`)
  console.log(`dry run: would free ${formatBytes(plan.freedBytes)}; nothing was deleted`)
} finally {
  rmSync(code, { recursive: true, force: true })
}
