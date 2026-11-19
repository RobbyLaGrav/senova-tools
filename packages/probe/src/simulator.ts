// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A noisy SCPI instrument simulator: a TCP server that answers like a bench DMM or power supply on a raw socket, with
// seeded Gaussian noise, an error queue, and switches for the faults tests need (slow replies, silence, garbage,
// dropped connections). Its readings are simulated, not measured.

import { createServer, type Server, type Socket } from "node:net"
import type { AddressInfo } from "node:net"

import { invalid } from "./errors.ts"
import { compilePattern, matchHeader, parseCommand, type HeaderPattern, type ParsedCommand } from "./syntax.ts"

export interface SimulatorOptions {
  /** Default "127.0.0.1". */
  host?: string
  /** Default 0: an ephemeral port; read it from the result. */
  port?: number
  /** "dmm" (default) or "psu". */
  kind?: "dmm" | "psu"
  /** Seed for the noise (default 1). The same seed gives the same sequence of readings. */
  seed?: number
  /** Noise as a fraction of the reading (standard deviation, default 0.0005 = 0.05 %). */
  noise?: number
  /** *IDN? reply (default "Probe,SIM-DMM,SIM0001,1.0" or "Probe,SIM-PSU,SIM0002,1.0"). */
  idn?: string
  /** True values the DMM reads around. */
  dmm?: { voltage?: number; current?: number; resistance?: number }
  /** Simulated supply: its own hardware range and the resistive load on its output. */
  psu?: { maxVoltage?: number; maxCurrent?: number; loadOhms?: number }
  /** Delay before each reply in ms (default 0). */
  replyDelayMs?: number
}

export interface PsuState {
  voltage: number
  current: number
  output: boolean
}

export interface Simulator {
  readonly host: string
  readonly port: number
  readonly kind: "dmm" | "psu"
  /** Every command line received, in order, across all connections. */
  readonly received: string[]
  /** Open client connections. */
  readonly connections: number
  /** The supply's setpoints (psu only). */
  readonly psu: PsuState
  /** The DMM's true values; change them to make readings move. */
  readonly dmm: { voltage: number; current: number; resistance: number }
  /** Delay before each reply in ms. */
  replyDelayMs: number
  /** When true, measurement queries are answered with garbage. */
  malformed: boolean
  /** When true, queries are never answered (the client times out). */
  silent: boolean
  /** Closes every client connection; the server keeps listening. */
  dropConnections(): void
  close(): Promise<void>
}

// Small seeded generator (mulberry32) with Box-Muller for Gaussian noise.
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return () => {
    const u = Math.max(next(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
  }
}

const nr3 = (v: number) => `${v >= 0 ? "+" : ""}${v.toExponential(8).toUpperCase()}`
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

type Result = string | undefined
interface Handler {
  pattern: HeaderPattern
  run: (cmd: ParsedCommand) => Result
}

export async function startSimulator(options: SimulatorOptions = {}): Promise<Simulator> {
  const host = options.host ?? "127.0.0.1"
  const kind = options.kind ?? "dmm"
  if (kind !== "dmm" && kind !== "psu") throw invalid('kind must be "dmm" or "psu"')
  const noise = options.noise ?? 0.0005
  if (typeof noise !== "number" || !Number.isFinite(noise) || noise < 0) throw invalid("noise must be a number of at least 0")
  const gauss = rng(options.seed ?? 1)
  const idn = options.idn ?? (kind === "dmm" ? "Probe,SIM-DMM,SIM0001,1.0" : "Probe,SIM-PSU,SIM0002,1.0")
  const dmm = { voltage: 5, current: 0.1, resistance: 1000, ...options.dmm }
  const hw = { maxVoltage: 30, maxCurrent: 3, loadOhms: 10, ...options.psu }
  const psu: PsuState = { voltage: 0, current: 0.1, output: false }
  const errors: string[] = []
  const received: string[] = []
  const sockets = new Set<Socket>()

  const pushError = (code: number, msg: string) => {
    if (errors.length >= 20) errors[19] = '-350,"Queue overflow"'
    else errors.push(`${code},"${msg}"`)
  }
  const noisy = (v: number) => v + gauss() * noise * Math.max(Math.abs(v), 1e-3)

  const sim: Simulator = {
    host,
    port: 0,
    kind,
    received,
    get connections() {
      return sockets.size
    },
    psu,
    dmm,
    replyDelayMs: options.replyDelayMs ?? 0,
    malformed: false,
    silent: false,
    dropConnections() {
      for (const s of sockets) s.destroy()
    },
    close: () => Promise.resolve(),
  }

  const reading = (v: number): Result => (sim.malformed ? "#garbled,,reply" : nr3(noisy(v)))
  const psuOut = () => {
    if (!psu.output) return { v: 0, i: 0 }
    const i = psu.voltage / hw.loadOhms
    return i <= psu.current ? { v: psu.voltage, i } : { v: psu.current * hw.loadOhms, i: psu.current }
  }
  const setNumber = (cmd: ParsedCommand, max: number, apply: (v: number) => void): Result => {
    if (!NUMBER.test(cmd.args)) return void pushError(-104, "Data type error")
    const v = Number(cmd.args)
    if (v < 0 || v > max) return void pushError(-222, "Data out of range")
    apply(v)
    return undefined
  }

  const table: [string, (cmd: ParsedCommand) => Result][] = [
    ["*IDN?", () => idn],
    ["*OPC?", () => "1"],
    ["*STB?", () => "0"],
    ["*ESR?", () => "0"],
    ["*CLS", () => void errors.splice(0)],
    ["*RST", () => {
      Object.assign(psu, { voltage: 0, current: 0.1, output: false })
      return undefined
    }],
    ["SYSTem:ERRor[:NEXT]?", () => errors.shift() ?? '+0,"No error"'],
  ]
  if (kind === "dmm") {
    table.push(
      ["MEASure[:SCALar]:VOLTage[:DC]?", () => reading(dmm.voltage)],
      ["MEASure[:SCALar]:CURRent[:DC]?", () => reading(dmm.current)],
      ["MEASure[:SCALar]:RESistance?", () => reading(dmm.resistance)],
    )
  } else {
    const VOLT = "[SOURce:]VOLTage[:LEVel][:IMMediate][:AMPLitude]"
    const CURR = "[SOURce:]CURRent[:LEVel][:IMMediate][:AMPLitude]"
    table.push(
      [VOLT, (c) => setNumber(c, hw.maxVoltage, (v) => (psu.voltage = v))],
      [CURR, (c) => setNumber(c, hw.maxCurrent, (v) => (psu.current = v))],
      [`${VOLT}?`, () => nr3(psu.voltage)],
      [`${CURR}?`, () => nr3(psu.current)],
      ["OUTPut[:STATe]", (c) => {
        const a = c.args.toUpperCase()
        if (a === "ON" || a === "1") psu.output = true
        else if (a === "OFF" || a === "0") psu.output = false
        else pushError(-224, "Illegal parameter value")
        return undefined
      }],
      ["OUTPut[:STATe]?", () => (psu.output ? "1" : "0")],
      ["MEASure[:SCALar]:VOLTage[:DC]?", () => reading(psuOut().v)],
      ["MEASure[:SCALar]:CURRent[:DC]?", () => reading(psuOut().i)],
    )
  }
  const handlers: Handler[] = table.map(([p, run]) => ({ pattern: compilePattern(p), run }))

  const handle = (line: string): Result => {
    let cmd: ParsedCommand
    try {
      cmd = parseCommand(line)
    } catch {
      pushError(-102, "Syntax error")
      return undefined
    }
    const h = handlers.find((x) => x.pattern.query === cmd.query && matchHeader(x.pattern, cmd.header))
    if (!h) {
      pushError(-113, "Undefined header")
      return undefined
    }
    if (cmd.query && sim.silent) return undefined
    return h.run(cmd)
  }

  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.setNoDelay(true)
    let buf = ""
    let chain = Promise.resolve()
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      let nl: number
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "")
        buf = buf.slice(nl + 1)
        if (line.trim() === "") continue
        received.push(line)
        // Replies go out in order, each after the configured delay.
        chain = chain.then(async () => {
          const out = handle(line)
          if (out === undefined) return
          if (sim.replyDelayMs > 0) await new Promise((r) => setTimeout(r, sim.replyDelayMs))
          if (!socket.destroyed) socket.write(`${out}\n`)
        })
      }
      if (buf.length > 65536) socket.destroy()
    })
    socket.on("error", () => {})
    socket.on("close", () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject)
      resolve()
    })
  })
  ;(sim as { port: number }).port = (server.address() as AddressInfo).port
  sim.close = () =>
    new Promise((resolve) => {
      for (const s of sockets) s.destroy()
      server.close(() => resolve())
    })
  return sim
}
