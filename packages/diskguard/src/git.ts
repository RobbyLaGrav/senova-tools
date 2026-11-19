// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Runs git as a child process (no shell), with a timeout, optional stdin, and the exit code returned to the caller.
import { spawn } from "node:child_process"

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs `git <args>` in `cwd`. Rejects only if git can't be started or times out; a non-zero exit is returned. */
export function git(cwd: string, args: readonly string[], input?: string, timeoutMs = 30_000): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // Never prompt (credentials, pagers): diskguard only reads local state.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", GIT_OPTIONAL_LOCKS: "0" },
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`git ${args.join(" ")} timed out after ${timeoutMs} ms in ${cwd}`))
    }, timeoutMs)
    child.stdout.on("data", (b: Buffer) => out.push(b))
    child.stderr.on("data", (b: Buffer) => err.push(b))
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") })
    })
    child.stdin.on("error", () => {})
    child.stdin.end(input ?? "")
  })
}
