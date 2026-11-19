// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Test helpers. Everything is created under os.tmpdir(); nothing here touches any other folder.
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync, lstatSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// An empty global git config, so the machine's own settings (hooks, templates, signing) don't affect the tests.
const emptyConfig = join(realpathSync(tmpdir()), `diskguard-gitconfig-${process.pid}`)
writeFileSync(emptyConfig, "")
process.on("exit", () => rmSync(emptyConfig, { force: true }))

// An empty global config, so the machine's own git settings (hooks, signing, templates) don't affect the tests.
const EMPTY_CONFIG = join(realpathSync(tmpdir()), `diskguard-gitconfig-${process.pid}`)
writeFileSync(EMPTY_CONFIG, "")
process.on("exit", () => rmSync(EMPTY_CONFIG, { force: true }))

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "diskguard test", GIT_AUTHOR_EMAIL: "test@invalid", GIT_COMMITTER_NAME: "diskguard test", GIT_COMMITTER_EMAIL: "test@invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig,
}

/** A fresh folder under os.tmpdir() (real path), removed by the returned cleanup. */
export function tempRoot(prefix: string): { dir: string; done: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `diskguard-${prefix}-`)))
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

/** Writes a file, creating its folders. `bytes` of filler content. */
export function put(path: string, bytes = 100): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "x".repeat(bytes))
}

export const GITIGNORE = [".next/", "node_modules/", "dist/", "build/", "out/", "target/", ".turbo/", "coverage/", "__pycache__/", ".pytest_cache/", ".parcel-cache/"].join("\n") + "\n"

/** A git repository with one commit (at `commitTime`, unix seconds) and a .gitignore listing the cache folders. */
export function makeRepo(dir: string, opts: { gitignore?: string; commitTime?: number; branch?: string } = {}): string {
  mkdirSync(dir, { recursive: true })
  sh(dir, "init", "-q", "-b", opts.branch ?? "main")
  writeFileSync(join(dir, ".gitignore"), opts.gitignore ?? GITIGNORE)
  put(join(dir, "src", "index.ts"), 20)
  sh(dir, "add", "-A")
  commit(dir, "first", opts.commitTime)
  return dir
}

export function commit(dir: string, message: string, time?: number): void {
  const env = time === undefined ? GIT_ENV : { ...GIT_ENV, GIT_AUTHOR_DATE: `${time} +0000`, GIT_COMMITTER_DATE: `${time} +0000` }
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], { cwd: dir, env, stdio: "ignore" })
}

/** Sets the modification time of a folder and everything in it to `minutes` ago. */
export function age(path: string, minutes: number): void {
  const t = new Date(Date.now() - minutes * 60_000)
  const st = lstatSync(path)
  if (st.isSymbolicLink()) return
  if (st.isDirectory()) for (const n of readdirSync(path)) age(join(path, n), minutes)
  utimesSync(path, t, t)
}

/**
 * Creates a directory link: a symlink, or on Windows without symlink rights a junction. Returns the kind made, or
 * undefined if the OS allows neither (the caller skips its test with a message).
 */
export function linkDir(target: string, link: string): "symlink" | "junction" | undefined {
  try {
    symlinkSync(target, link, "dir")
    return "symlink"
  } catch {
    if (process.platform !== "win32") return undefined
    try {
      symlinkSync(target, link, "junction")
      return "junction"
    } catch {
      return undefined
    }
  }
}
