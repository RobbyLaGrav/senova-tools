// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// SCPI over raw TCP (the "socket" port, 5025 by default), on node:net. One command in flight at a time, the rest
// queued; newline framing; a timeout on every command; reconnect with exponential backoff and jitter after the
// connection drops; error-queue reads with SYST:ERR?.
//
// A query that times out closes the connection on purpose: its reply may still arrive later, and on a raw socket it
// would be read as the answer to the next query. Reconnecting resynchronises the stream.

import { EventEmitter } from "node:events"
import { createConnection, type Socket } from "node:net"
import { StringDecoder } from "node:string_decoder"

import { invalid, ProbeError, type InstrumentErrorEntry } from "./errors.ts"
import { validateCommand } from "./syntax.ts"

export interface ReconnectOptions {
  /** First retry delay in ms (default 100). */
  initialMs?: number
  /** Largest retry delay in ms (default 5000). */
  maxMs?: number
  /** Growth per attempt (default 2). */
  factor?: number
  /** Give up after this many failed attempts in a row (default: never). */
  maxAttempts?: number
}

export interface ScpiClientOptions {
  /** Default "127.0.0.1". */
  host?: string
  /** Default 5025, the usual SCPI raw-socket port. */
  port?: number
  /** Per-command timeout in ms (default 2000). */
  timeoutMs?: number
  /** Timeout for one TCP connect attempt in ms (default 3000). */
  connectTimeoutMs?: number
  /** Reconnect after a drop (default true). false: a drop fails every queued command. */
  reconnect?: boolean | ReconnectOptions
  /** Most commands that may wait in the queue (default 64). More are refused with QUEUE_FULL. */
  maxQueue?: number
  /** Longest reply line accepted, in characters (default 65536). Longer closes the connection with BAD_REPLY. */
  maxLineLength?: number
}

export interface CommandOptions {
  /** Overrides the client's timeoutMs for this command. */
  timeoutMs?: number
}

export type ClientState = "idle" | "connecting" | "connected" | "waiting" | "closed"

interface Pending {
  command: string
  query: boolean
  timeoutMs: number
  resolve: (reply: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout | undefined
}

interface Waiter {
  resolve: () => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const positive = (v: unknown, name: string, fallback: number): number => {
  if (v === undefined) return fallback
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw invalid(`${name} must be a positive number`)
  return v
}

/**
 * A SCPI raw-socket client. Events: "connect", "disconnect" (error or undefined), "reconnecting" ({attempt, delayMs}),
 * "giveup", "unsolicited" (a line that arrived with no query waiting for it).
 */
export class ScpiClient extends EventEmitter {
  readonly host: string
  readonly port: number
  readonly timeoutMs: number
  readonly connectTimeoutMs: number
  readonly maxQueue: number
  readonly maxLineLength: number
  readonly stats = { sent: 0, timeouts: 0, connects: 0, drops: 0, unsolicited: 0 }

  #state: ClientState = "idle"
  #reconnect: Required<ReconnectOptions> | null
  #socket: Socket | null = null
  #decoder = new StringDecoder("utf8")
  #buffer = ""
  #queue: Pending[] = []
  #inFlight: Pending | null = null
  #attempt = 0
  #retryTimer: NodeJS.Timeout | null = null
  #waiters: Waiter[] = []

  constructor(options: ScpiClientOptions = {}) {
    super()
    if (options === null || typeof options !== "object") throw invalid("ScpiClient options must be an object")
    const host = options.host ?? "127.0.0.1"
    if (typeof host !== "string" || host.length === 0) throw invalid("host must be a non-empty string")
    const port = options.port ?? 5025
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid("port must be an integer from 1 to 65535")
    this.host = host
    this.port = port
    this.timeoutMs = positive(options.timeoutMs, "timeoutMs", 2000)
    this.connectTimeoutMs = positive(options.connectTimeoutMs, "connectTimeoutMs", 3000)
    this.maxQueue = positive(options.maxQueue, "maxQueue", 64)
    this.maxLineLength = positive(options.maxLineLength, "maxLineLength", 65536)
    const r = options.reconnect ?? true
    if (r === false) this.#reconnect = null
    else {
      const o: ReconnectOptions = r === true ? {} : r
      const factor = positive(o.factor, "reconnect.factor", 2)
      if (factor < 1) throw invalid("reconnect.factor must be at least 1")
      const maxAttempts = o.maxAttempts === undefined ? Infinity : o.maxAttempts
      if (maxAttempts !== Infinity && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
        throw invalid("reconnect.maxAttempts must be a positive integer")
      }
      this.#reconnect = {
        initialMs: positive(o.initialMs, "reconnect.initialMs", 100),
        maxMs: positive(o.maxMs, "reconnect.maxMs", 5000),
        factor,
        maxAttempts,
      }
    }
  }

  get state(): ClientState {
    return this.#state
  }

  /** "host:port", used as the instrument name when none is given. */
  get address(): string {
    return `${this.host}:${this.port}`
  }

  /**
   * Connects (or waits for the reconnect in progress). Rejects with CONNECTION when the attempt fails and reconnect
   * is off, when reconnect gives up, or after `timeoutMs` (default 10000) without a connection.
   */
  connect(options: CommandOptions = {}): Promise<void> {
    if (this.#state === "closed") return Promise.reject(new ProbeError("CLOSED", "client is closed"))
    if (this.#state === "connected") return Promise.resolve()
    const timeoutMs = positive(options.timeoutMs, "timeoutMs", 10000)
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#waiters = this.#waiters.filter((w) => w !== waiter)
          reject(new ProbeError("CONNECTION", `could not connect to ${this.address} within ${timeoutMs} ms`))
        }, timeoutMs),
      }
      this.#waiters.push(waiter)
      if (this.#state === "idle") this.#open()
    })
  }

  /** Sends a query (a command ending in "?" in its header) and resolves with the reply line, without the newline. */
  query(command: string, options: CommandOptions = {}): Promise<string> {
    return this.#enqueue(command, true, options)
  }

  /** Sends a command that has no reply. Resolves once it is written to the socket. */
  async write(command: string, options: CommandOptions = {}): Promise<void> {
    await this.#enqueue(command, false, options)
  }

  /**
   * Reads the instrument's error queue with SYST:ERR? until it reports 0 (no error), at most 32 entries.
   * Returns the errors in the order the instrument reported them; an empty array means no errors.
   */
  async errors(options: CommandOptions = {}): Promise<InstrumentErrorEntry[]> {
    const out: InstrumentErrorEntry[] = []
    for (let i = 0; i < 32; i++) {
      const reply = await this.query("SYST:ERR?", options)
      const m = /^\s*([+-]?\d+)\s*,\s*"(.*)"\s*$/.exec(reply)
      if (!m) throw new ProbeError("BAD_REPLY", `malformed SYST:ERR? reply: ${JSON.stringify(reply.slice(0, 80))}`)
      const code = Number(m[1])
      if (code === 0) break
      out.push({ code, message: m[2]! })
    }
    return out
  }

  /** Closes the connection and stops reconnecting. Every queued command fails with CLOSED. */
  close(): Promise<void> {
    if (this.#state === "closed" && this.#socket === null) return Promise.resolve()
    this.#state = "closed"
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#retryTimer = null
    this.#failAll(new ProbeError("CLOSED", "client closed"))
    for (const w of this.#waiters.splice(0)) {
      clearTimeout(w.timer)
      w.reject(new ProbeError("CLOSED", "client closed"))
    }
    const socket = this.#socket
    if (!socket) return Promise.resolve()
    return new Promise((resolve) => {
      const force = setTimeout(() => socket.destroy(), 500)
      socket.once("close", () => {
        clearTimeout(force)
        resolve()
      })
      socket.end()
    })
  }

  #enqueue(command: string, query: boolean, options: CommandOptions): Promise<string> {
    let cmd: string
    try {
      cmd = validateCommand(command)
      const header = cmd.split(/\s/, 1)[0]!
      if (query && !header.endsWith("?")) throw new ProbeError("INVALID_COMMAND", `query "${cmd}" has no "?" in its header`)
      if (!query && header.endsWith("?")) {
        throw new ProbeError("INVALID_COMMAND", `"${cmd}" is a query: use query(), or its reply would be read as the next answer`)
      }
    } catch (err) {
      return Promise.reject(err)
    }
    if (this.#state === "closed") return Promise.reject(new ProbeError("CLOSED", "client is closed"))
    if (this.#queue.length >= this.maxQueue) {
      return Promise.reject(new ProbeError("QUEUE_FULL", `${this.maxQueue} commands already waiting for ${this.address}`))
    }
    let timeoutMs: number
    try {
      timeoutMs = positive(options.timeoutMs, "timeoutMs", this.timeoutMs)
    } catch (err) {
      return Promise.reject(err)
    }
    return new Promise((resolve, reject) => {
      const p: Pending = { command: cmd, query, timeoutMs, resolve, reject, timer: undefined }
      this.#queue.push(p)
      if (this.#state !== "connected") this.#startWaitTimer(p)
      if (this.#state === "idle") this.#open()
      this.#pump()
    })
  }

  /** While disconnected, a queued command waits at most its own timeout for the connection to come back. */
  #startWaitTimer(p: Pending): void {
    if (p.timer) return
    p.timer = setTimeout(() => {
      this.#queue = this.#queue.filter((q) => q !== p)
      this.stats.timeouts++
      p.reject(new ProbeError("TIMEOUT", `"${p.command}": not connected to ${this.address} within ${p.timeoutMs} ms`))
    }, p.timeoutMs)
  }

  #open(): void {
    if (this.#state === "closed") return
    this.#state = "connecting"
    this.#buffer = ""
    this.#decoder = new StringDecoder("utf8")
    const socket = createConnection({ host: this.host, port: this.port })
    this.#socket = socket
    socket.setNoDelay(true)
    const connectTimer = setTimeout(
      () => socket.destroy(new ProbeError("CONNECTION", `connect to ${this.address} timed out after ${this.connectTimeoutMs} ms`)),
      this.connectTimeoutMs,
    )
    let lastError: Error | undefined
    socket.on("connect", () => {
      clearTimeout(connectTimer)
      if (this.#state === "closed") return
      socket.setKeepAlive(true, 10000)
      this.#state = "connected"
      this.#attempt = 0
      this.stats.connects++
      for (const p of this.#queue) {
        if (p.timer) clearTimeout(p.timer)
        p.timer = undefined
      }
      for (const w of this.#waiters.splice(0)) {
        clearTimeout(w.timer)
        w.resolve()
      }
      this.emit("connect")
      this.#pump()
    })
    socket.on("data", (chunk: Buffer) => this.#onData(socket, chunk))
    socket.on("error", (err) => {
      lastError = err
    })
    socket.on("close", () => {
      clearTimeout(connectTimer)
      if (this.#socket !== socket) return
      this.#socket = null
      const wasConnected = this.#state === "connected"
      if (wasConnected) this.stats.drops++
      const why = lastError ? `: ${lastError.message}` : ""
      const err = new ProbeError(
        "CONNECTION",
        wasConnected ? `connection to ${this.address} dropped${why}` : `could not connect to ${this.address}${why}`,
        { cause: lastError },
      )
      if (this.#inFlight) {
        const p = this.#inFlight
        this.#inFlight = null
        if (p.timer) clearTimeout(p.timer)
        p.reject(err)
      }
      if (wasConnected) this.emit("disconnect", lastError)
      if (this.#state === "closed") return
      if (!this.#reconnect) {
        this.#state = "idle"
        this.#failAll(err)
        for (const w of this.#waiters.splice(0)) {
          clearTimeout(w.timer)
          w.reject(err)
        }
        return
      }
      this.#scheduleRetry(err)
    })
  }

  #scheduleRetry(err: ProbeError): void {
    const r = this.#reconnect!
    this.#attempt++
    if (this.#attempt > r.maxAttempts) {
      this.#state = "idle"
      this.#attempt = 0
      const giveup = new ProbeError("CONNECTION", `gave up reconnecting to ${this.address} after ${r.maxAttempts} attempts`, { cause: err })
      this.#failAll(giveup)
      for (const w of this.#waiters.splice(0)) {
        clearTimeout(w.timer)
        w.reject(giveup)
      }
      this.emit("giveup", giveup)
      return
    }
    // Exponential backoff with jitter: between half and all of the capped delay, so many clients don't retry in step.
    const base = Math.min(r.maxMs, r.initialMs * r.factor ** (this.#attempt - 1))
    const delayMs = Math.round(base * (0.5 + Math.random() * 0.5))
    this.#state = "waiting"
    for (const p of this.#queue) this.#startWaitTimer(p)
    this.emit("reconnecting", { attempt: this.#attempt, delayMs })
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null
      if (this.#state === "waiting") this.#open()
    }, delayMs)
    // Retrying alone doesn't keep the process alive; pending commands and connect() callers have their own timers.
    this.#retryTimer.unref()
  }

  #onData(socket: Socket, chunk: Buffer): void {
    if (this.#socket !== socket) return
    this.#buffer += this.#decoder.write(chunk)
    let nl: number
    while ((nl = this.#buffer.indexOf("\n")) !== -1) {
      const line = this.#buffer.slice(0, nl).replace(/\r$/, "")
      this.#buffer = this.#buffer.slice(nl + 1)
      const p = this.#inFlight
      if (p && p.query) {
        this.#inFlight = null
        if (p.timer) clearTimeout(p.timer)
        p.resolve(line)
      } else {
        this.stats.unsolicited++
        this.emit("unsolicited", line)
      }
    }
    if (this.#buffer.length > this.maxLineLength) {
      const err = new ProbeError("BAD_REPLY", `reply from ${this.address} longer than ${this.maxLineLength} characters with no newline`)
      if (this.#inFlight) {
        const p = this.#inFlight
        this.#inFlight = null
        if (p.timer) clearTimeout(p.timer)
        p.reject(err)
      }
      this.#buffer = ""
      socket.destroy(err)
      return
    }
    this.#pump()
  }

  #pump(): void {
    // A socket destroyed to resynchronise (timeout, overlong reply) is dead even before its "close" event fires.
    if (this.#inFlight || this.#state !== "connected" || !this.#socket || this.#socket.destroyed) return
    const p = this.#queue.shift()
    if (!p) return
    const socket = this.#socket
    this.#inFlight = p
    if (p.timer) clearTimeout(p.timer)
    p.timer = setTimeout(() => {
      if (this.#inFlight !== p) return
      this.#inFlight = null
      this.stats.timeouts++
      p.reject(new ProbeError("TIMEOUT", `no reply to "${p.command}" from ${this.address} within ${p.timeoutMs} ms`))
      // Resynchronise: a late reply on this socket would otherwise answer the next query.
      if (p.query) socket.destroy()
      else this.#pump()
    }, p.timeoutMs)
    this.stats.sent++
    socket.write(`${p.command}\n`, (err) => {
      if (this.#inFlight !== p || p.query) return
      this.#inFlight = null
      if (p.timer) clearTimeout(p.timer)
      if (err) p.reject(new ProbeError("CONNECTION", `write of "${p.command}" failed: ${err.message}`, { cause: err }))
      else p.resolve("")
      this.#pump()
    })
  }

  #failAll(err: Error): void {
    const all = this.#inFlight ? [this.#inFlight, ...this.#queue] : [...this.#queue]
    this.#inFlight = null
    this.#queue = []
    for (const p of all) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(err)
    }
  }
}
