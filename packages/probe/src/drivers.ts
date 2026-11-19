// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Typed drivers on top of ScpiClient: a generic instrument (*IDN?, error queue), a digital multimeter and a
// programmable power supply. Every command goes through the instrument's CommandGuard first.

import type { ScpiClient } from "./client.ts"
import { InstrumentError, invalid, ProbeError, type InstrumentErrorEntry } from "./errors.ts"
import { CommandGuard, type WriteRule } from "./guard.ts"
import { measurement, parseScpiNumber, type Measurement, type Quantity } from "./measurement.ts"

export interface Identity {
  manufacturer: string
  model: string
  serial: string
  firmware: string
}

export interface InstrumentOptions {
  /** Name carried by every measurement (default: the client's "host:port"). */
  name?: string
  /** Read the error queue after every write and throw InstrumentError if it isn't empty (default true). */
  checkErrors?: boolean
  /** Extra writes to allow on top of the driver's own rules. */
  allowWrites?: WriteRule[]
  /** Extra queries to allow on top of the driver's own, e.g. ["CONFigure?"]. */
  allowQueries?: string[]
}

/** Queries every driver allows: identification, status and the error queue. */
export const COMMON_QUERIES = ["*IDN?", "*OPC?", "*STB?", "*ESR?", "SYSTem:ERRor[:NEXT]?"]

export class Instrument {
  readonly client: ScpiClient
  readonly name: string
  readonly guard: CommandGuard
  readonly checkErrors: boolean
  identity: Identity | null = null

  constructor(client: ScpiClient, options: InstrumentOptions = {}) {
    if (!client || typeof client.query !== "function") throw invalid("Instrument needs a ScpiClient")
    const name = options.name ?? client.address
    if (typeof name !== "string" || name.length === 0 || name.length > 200) throw invalid("name must be 1 to 200 characters")
    this.client = client
    this.name = name
    this.checkErrors = options.checkErrors ?? true
    this.guard = new CommandGuard({ queries: COMMON_QUERIES })
    for (const rule of options.allowWrites ?? []) this.guard.allowWrite(rule)
    for (const q of options.allowQueries ?? []) this.guard.allowQuery(q)
  }

  /** Sends *IDN? and parses "manufacturer,model,serial,firmware". */
  async identify(): Promise<Identity> {
    const reply = await this.query("*IDN?")
    const parts = reply.split(",").map((s) => s.trim())
    if (parts.length !== 4 || parts.some((p) => p === "")) {
      throw new ProbeError("BAD_REPLY", `*IDN? reply is not "manufacturer,model,serial,firmware": ${JSON.stringify(reply.slice(0, 120))}`)
    }
    const [manufacturer, model, serial, firmware] = parts as [string, string, string, string]
    this.identity = { manufacturer, model, serial, firmware }
    return this.identity
  }

  /** Sends an allowed query and returns the raw reply. */
  query(command: string): Promise<string> {
    try {
      this.guard.checkQuery(command)
    } catch (err) {
      return Promise.reject(err)
    }
    return this.client.query(command)
  }

  /** Sends an allowed write, then (by default) checks the error queue. */
  async write(command: string): Promise<void> {
    this.guard.checkWrite(command)
    await this.client.write(command)
    if (this.checkErrors) {
      const errors = await this.client.errors()
      if (errors.length > 0) throw new InstrumentError(command.trim(), errors)
    }
  }

  /** Reads the error queue (SYST:ERR? until 0). */
  errors(): Promise<InstrumentErrorEntry[]> {
    return this.client.errors()
  }

  /** Sends an allowed numeric query and wraps the reply as a typed measurement. */
  async measure(command: string, quantity: Quantity): Promise<Measurement> {
    const reply = await this.query(command)
    return measurement({ quantity, value: parseScpiNumber(reply, command), instrument: this.name })
  }
}

/** A digital multimeter: DC voltage, DC current and resistance. */
export class Dmm extends Instrument {
  constructor(client: ScpiClient, options: InstrumentOptions = {}) {
    super(client, options)
    for (const q of ["MEASure[:SCALar]:VOLTage[:DC]?", "MEASure[:SCALar]:CURRent[:DC]?", "MEASure[:SCALar]:RESistance?"]) {
      this.guard.allowQuery(q)
    }
  }

  voltageDc(): Promise<Measurement> {
    return this.measure("MEAS:VOLT:DC?", "voltage")
  }

  currentDc(): Promise<Measurement> {
    return this.measure("MEAS:CURR:DC?", "current")
  }

  resistance(): Promise<Measurement> {
    return this.measure("MEAS:RES?", "resistance")
  }
}

export interface PsuLimits {
  /** Highest voltage setpoint the driver will send, in volts. Required. */
  maxVoltage: number
  /** Highest current limit the driver will send, in amperes. Required. */
  maxCurrent: number
}

export interface PsuOptions extends InstrumentOptions {
  limits: PsuLimits
}

const VOLT = "[SOURce:]VOLTage[:LEVel][:IMMediate][:AMPLitude]"
const CURR = "[SOURce:]CURRent[:LEVel][:IMMediate][:AMPLitude]"
const OUTP = "OUTPut[:STATe]"

/** A programmable DC power supply. Setpoints above the configured limits are refused before they are sent. */
export class Psu extends Instrument {
  readonly limits: Readonly<PsuLimits>

  constructor(client: ScpiClient, options: PsuOptions) {
    if (!options || typeof options !== "object" || !options.limits || typeof options.limits !== "object") {
      throw invalid("Psu needs limits: { maxVoltage, maxCurrent }")
    }
    const { maxVoltage, maxCurrent } = options.limits
    for (const [k, v] of [["maxVoltage", maxVoltage], ["maxCurrent", maxCurrent]] as const) {
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw invalid(`limits.${k} must be a positive number`)
    }
    super(client, options)
    this.limits = Object.freeze({ maxVoltage, maxCurrent })
    this.guard.allowWrite({ pattern: VOLT, limit: { max: maxVoltage, quantity: "voltage" } })
    this.guard.allowWrite({ pattern: CURR, limit: { max: maxCurrent, quantity: "current" } })
    this.guard.allowWrite({ pattern: OUTP, values: ["ON", "OFF", "1", "0"] })
    for (const q of [`${VOLT}?`, `${CURR}?`, `${OUTP}?`, "MEASure[:SCALar]:VOLTage[:DC]?", "MEASure[:SCALar]:CURRent[:DC]?"]) {
      this.guard.allowQuery(q)
    }
  }

  /** Sets the voltage setpoint in volts (0 to limits.maxVoltage). */
  async setVoltage(volts: number): Promise<void> {
    await this.write(`VOLT ${numberArg(volts, "volts")}`)
  }

  /** Sets the current limit in amperes (0 to limits.maxCurrent). */
  async setCurrent(amps: number): Promise<void> {
    await this.write(`CURR ${numberArg(amps, "amps")}`)
  }

  /** Turns the output on or off. */
  async output(on: boolean): Promise<void> {
    if (typeof on !== "boolean") throw invalid("output() takes true or false")
    await this.write(`OUTP ${on ? "ON" : "OFF"}`)
  }

  /** Reads whether the output is on. */
  async outputState(): Promise<boolean> {
    const reply = (await this.query("OUTP?")).trim().toUpperCase()
    if (reply === "1" || reply === "ON") return true
    if (reply === "0" || reply === "OFF") return false
    throw new ProbeError("BAD_REPLY", `OUTP? reply is not 0/1/ON/OFF: ${JSON.stringify(reply.slice(0, 40))}`)
  }

  measureVoltage(): Promise<Measurement> {
    return this.measure("MEAS:VOLT?", "voltage")
  }

  measureCurrent(): Promise<Measurement> {
    return this.measure("MEAS:CURR?", "current")
  }
}

const numberArg = (v: number, name: string): string => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw invalid(`${name} must be a finite number`)
  return String(v)
}
