// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A board is anything that can be flashed, reset and talked to line by line. CommandBoard drives a real one with the
// user's own flash and reset programs and a TCP bridge to its serial console.
import { spawn } from "node:child_process"
import { Socket } from "node:net"

import { BenchError, invalid } from "./errors.ts"
import { LineBuffer } from "./lines.ts"

export interface Board {
  readonly name: string
  readonly console: LineBuffer
  flash(image: string): Promise<void>
  reset(): Promise<void>
  send(line: string): Promise<void>
  close(): Promise<void>
}

export interface CommandSpec {
  command: string
  args?: readonly string[]
  cwd?: string
  env?: Record<string, string>
  /** Default 120000. */
  timeoutMs?: number
}

export interface ConsoleSpec {
  host: string
  port: number
  /** Default 3000. */
  connectTimeoutMs?: number
}

export interface CommandBoardOptions {
  name: string
  flash?: CommandSpec
  reset?: CommandSpec
  console?: ConsoleSpec
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Board names end up in lock-file names and reports, so they are kept to a safe character set. */
export function checkBoardName(name: unknown): string {
  if (typeof name !== "string" || !NAME.test(name)) {
    throw invalid("board name must be 1-64 letters, digits, dots, dashes or underscores, starting with a letter or digit")
  }
  return name
}

/** Checks one line before it is written to a console: no line breaks, so one send is exactly one line. */
export function checkLine(line: unknown): string {
  if (typeof line !== "string") throw invalid("a console line must be a string")
  if (/[\r\n]/.test(line)) throw invalid("a console line must not contain line breaks")
  if (line.length > 4096) throw invalid("a console line is limited to 4096 characters")
  return line
}

function checkSpec(spec: CommandSpec, what: string): void {
  if (!spec || typeof spec.command !== "string" || spec.command.length === 0) throw invalid(`${what}.command is required`)
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== "string"))) {
    throw invalid(`${what}.args must be an array of strings`)
  }
  if (spec.timeoutMs !== undefined && !(Number.isFinite(spec.timeoutMs) && spec.timeoutMs > 0)) {
    throw invalid(`${what}.timeoutMs must be a positive number`)
  }
}

/**
 * Runs a program without a shell and resolves when it exits 0. `{name}` in an argument is replaced from `vars`.
 * Throws COMMAND_FAILED on a non-zero exit, a timeout or a missing program, with the last lines of its output.
 */
export function runCommand(spec: CommandSpec, vars: Record<string, string> = {}): Promise<void> {
  checkSpec(spec, "command")
  const args = (spec.args ?? []).map((a) => a.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m))
  const timeoutMs = spec.timeoutMs ?? 120_000
  return new Promise((resolve, reject) => {
    let out = ""
    const keep = (chunk: Buffer) => {
      out = (out + chunk.toString("utf8")).slice(-8192)
    }
    const child = spawn(spec.command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
      env: { ...process.env, ...spec.env },
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.stdout.on("data", keep)
    child.stderr.on("data", keep)
    const tail = () => out.trimEnd().split(/\r?\n/).slice(-10).join("\n")
    child.once("error", (err) => {
      clearTimeout(timer)
      reject(new BenchError("COMMAND_FAILED", `${spec.command} could not start: ${err.message}`, { cause: err }))
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      if (timedOut) reject(new BenchError("COMMAND_FAILED", `${spec.command} timed out after ${timeoutMs} ms\n${tail()}`.trimEnd()))
      else if (code === 0) resolve()
      else reject(new BenchError("COMMAND_FAILED", `${spec.command} exited with ${code ?? signal}\n${tail()}`.trimEnd()))
    })
  })
}

export class CommandBoard implements Board {
  readonly name: string
  readonly console = new LineBuffer()
  #options: CommandBoardOptions
  #socket: Socket | undefined
  #connecting: Promise<Socket> | undefined
  #closed = false

  constructor(options: CommandBoardOptions) {
    this.name = checkBoardName(options?.name)
    if (options.flash) checkSpec(options.flash, "flash")
    if (options.reset) checkSpec(options.reset, "reset")
    if (options.console) {
      const { host, port } = options.console
      if (typeof host !== "string" || host.length === 0) throw invalid("console.host is required")
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid("console.port must be 1-65535")
    }
    this.#options = options
  }

  async flash(image: string): Promise<void> {
    if (typeof image !== "string" || image.length === 0) throw invalid("image must be a non-empty path")
    this.#open()
    if (!this.#options.flash) throw new BenchError("BOARD", `${this.name} has no flash command`)
    // Connect first so the boot lines printed straight after flashing are captured.
    if (this.#options.console) await this.#connect()
    await runCommand(this.#options.flash, { image })
  }

  async reset(): Promise<void> {
    this.#open()
    if (this.#options.console) await this.#connect()
    if (this.#options.reset) await runCommand(this.#options.reset)
  }

  async send(line: string): Promise<void> {
    checkLine(line)
    this.#open()
    if (!this.#options.console) throw new BenchError("BOARD", `${this.name} has no console`)
    const socket = await this.#connect()
    await new Promise<void>((resolve, reject) =>
      socket.write(line + "\n", (err) => (err ? reject(new BenchError("BOARD", `console write failed: ${err.message}`)) : resolve())),
    )
  }

  async close(): Promise<void> {
    this.#closed = true
    this.#socket?.destroy()
    this.#socket = undefined
  }

  #open(): void {
    if (this.#closed) throw new BenchError("CLOSED", `${this.name} is closed`)
  }

  #connect(): Promise<Socket> {
    if (this.#socket && !this.#socket.destroyed) return Promise.resolve(this.#socket)
    if (this.#connecting) return this.#connecting
    const spec = this.#options.console as ConsoleSpec
    const timeoutMs = spec.connectTimeoutMs ?? 3000
    this.#connecting = new Promise<Socket>((resolve, reject) => {
      const socket = new Socket()
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new BenchError("BOARD", `console ${spec.host}:${spec.port} did not connect within ${timeoutMs} ms`))
      }, timeoutMs)
      socket.setEncoding("utf8")
      socket.on("data", (text: string) => this.console.push(text))
      socket.on("error", (err) => {
        clearTimeout(timer)
        reject(new BenchError("BOARD", `console ${spec.host}:${spec.port}: ${err.message}`, { cause: err }))
      })
      socket.once("close", () => {
        if (this.#socket === socket) this.#socket = undefined
      })
      socket.connect(spec.port, spec.host, () => {
        clearTimeout(timer)
        this.#socket = socket
        resolve(socket)
      })
    }).finally(() => {
      this.#connecting = undefined
    })
    return this.#connecting
  }
}
