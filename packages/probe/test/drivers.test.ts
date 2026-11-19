// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { Dmm, Instrument, InstrumentError, ProbeError, Psu, ScpiClient, startSimulator, type Simulator } from "../src/index.ts"

const code = (c: string) => (err: unknown) => err instanceof ProbeError && err.code === c

async function withSim<T>(kind: "dmm" | "psu", fn: (sim: Simulator, client: ScpiClient) => Promise<T>, seed = 1): Promise<T> {
  const sim = await startSimulator({ kind, seed })
  const client = new ScpiClient({ port: sim.port, timeoutMs: 500, reconnect: { initialMs: 10 } })
  try {
    return await fn(sim, client)
  } finally {
    await client.close()
    await sim.close()
  }
}

test("generic instrument: *IDN? is parsed; a bad *IDN? reply is BAD_REPLY", async () => {
  await withSim("dmm", async (_sim, client) => {
    const inst = new Instrument(client)
    assert.deepEqual(await inst.identify(), { manufacturer: "Probe", model: "SIM-DMM", serial: "SIM0001", firmware: "1.0" })
    assert.equal(inst.name, client.address)
  })
  const sim = await startSimulator({ idn: "just one field" })
  const client = new ScpiClient({ port: sim.port })
  await assert.rejects(new Instrument(client).identify(), code("BAD_REPLY"))
  await client.close()
  await sim.close()
})

test("DMM: typed, noisy readings around the simulated values", async () => {
  await withSim("dmm", async (sim, client) => {
    const dmm = new Dmm(client, { name: "dmm1" })
    const v = await dmm.voltageDc()
    assert.equal(v.quantity, "voltage")
    assert.equal(v.unit, "V")
    assert.equal(v.instrument, "dmm1")
    assert.ok(Math.abs(v.value - 5) < 0.05 && v.value !== 5, String(v.value))
    assert.ok(Math.abs(Date.now() - v.t) < 5000)
    const i = await dmm.currentDc()
    assert.deepEqual([i.quantity, i.unit], ["current", "A"])
    const r = await dmm.resistance()
    assert.deepEqual([r.quantity, r.unit], ["resistance", "Ω"])
    assert.ok(Math.abs(r.value - 1000) < 10)
    sim.dmm.voltage = 1.25
    assert.ok(Math.abs((await dmm.voltageDc()).value - 1.25) < 0.01)
  })
})

test("simulator noise is seeded: the same seed gives the same readings", async () => {
  const read = (seed: number) =>
    withSim("dmm", async (_s, client) => {
      const dmm = new Dmm(client)
      return [(await dmm.voltageDc()).value, (await dmm.voltageDc()).value]
    }, seed)
  assert.deepEqual(await read(42), await read(42))
  assert.notDeepEqual(await read(42), await read(43))
})

test("PSU: setpoints, output and measured values follow a resistive load", async () => {
  await withSim("psu", async (sim, client) => {
    const psu = new Psu(client, { name: "psu1", limits: { maxVoltage: 12, maxCurrent: 1 } })
    assert.equal(await psu.outputState(), false)
    await psu.setCurrent(0.5)
    await psu.setVoltage(3.3)
    assert.ok(Math.abs((await psu.measureVoltage()).value) < 1e-4) // output off: only the noise floor
    await psu.output(true)
    assert.equal(await psu.outputState(), true)
    assert.deepEqual(sim.psu, { voltage: 3.3, current: 0.5, output: true })
    const v = await psu.measureVoltage()
    const i = await psu.measureCurrent()
    assert.ok(Math.abs(v.value - 3.3) < 0.02, String(v.value))
    assert.ok(Math.abs(i.value - 0.33) < 0.01, String(i.value)) // 3.3 V into the simulator's 10 ohm load
    // Current limited: 12 V into 10 ohms would be 1.2 A, but the limit is 0.5 A.
    await psu.setVoltage(12)
    assert.ok(Math.abs((await psu.measureCurrent()).value - 0.5) < 0.01)
    assert.ok(Math.abs((await psu.measureVoltage()).value - 5) < 0.02)
    await psu.output(false)
    assert.equal(sim.psu.output, false)
  })
})

test("PSU: writes over the configured limits are refused before they reach the socket", async () => {
  await withSim("psu", async (sim, client) => {
    const psu = new Psu(client, { limits: { maxVoltage: 12, maxCurrent: 1 } })
    await assert.rejects(psu.setVoltage(12.5), code("LIMIT_EXCEEDED"))
    await assert.rejects(psu.setVoltage(-1), code("LIMIT_EXCEEDED"))
    await assert.rejects(psu.setCurrent(1.01), code("LIMIT_EXCEEDED"))
    await assert.rejects(psu.setVoltage(Number.NaN), code("INVALID_ARGUMENT"))
    await assert.rejects(psu.write("SOUR:VOLT:LEV 30"), code("LIMIT_EXCEEDED"))
    await assert.rejects(psu.write("VOLT MAX"), code("LIMIT_EXCEEDED"))
    // Allowing a looser rule on top can't widen the limit.
    const loose = new Psu(client, { limits: { maxVoltage: 12, maxCurrent: 1 }, allowWrites: [{ pattern: "VOLTage", anyArgs: true }] })
    await assert.rejects(loose.write("VOLT 20"), code("LIMIT_EXCEEDED"))
    assert.deepEqual(sim.received, [])
    assert.equal(sim.psu.voltage, 0)
  })
})

test("allow list: writes and queries the driver doesn't know are refused before they reach the socket", async () => {
  await withSim("dmm", async (sim, client) => {
    const dmm = new Dmm(client)
    await assert.rejects(dmm.write("*RST"), code("WRITE_REFUSED"))
    await assert.rejects(dmm.write("CONF:VOLT:DC 10"), code("WRITE_REFUSED"))
    await assert.rejects(dmm.query("*CAL?"), code("WRITE_REFUSED"))
    await assert.rejects(dmm.write("*CLS;*RST"), code("INVALID_COMMAND"))
    await assert.rejects(dmm.query("MEAS:VOLT:DC?\n*RST"), code("INVALID_COMMAND"))
    assert.deepEqual(sim.received, [])
  })
  await withSim("psu", async (sim, client) => {
    const psu = new Psu(client, { limits: { maxVoltage: 5, maxCurrent: 1 } })
    await assert.rejects(psu.write("OUTP MAYBE"), code("WRITE_REFUSED"))
    await assert.rejects(psu.write("VOLT:PROT 40"), code("WRITE_REFUSED"))
    assert.deepEqual(sim.received, [])
  })
  assert.throws(() => new Psu(new ScpiClient(), {} as never), code("INVALID_ARGUMENT"))
  assert.throws(() => new Psu(new ScpiClient(), { limits: { maxVoltage: 0, maxCurrent: 1 } }), code("INVALID_ARGUMENT"))
  assert.throws(() => new Psu(new ScpiClient(), { limits: { maxVoltage: 5, maxCurrent: Infinity } }), code("INVALID_ARGUMENT"))
})

test("errors the instrument reports after a write surface as InstrumentError", async () => {
  await withSim("dmm", async (_sim, client) => {
    // Allowed by the guard, but the simulated DMM doesn't know it.
    const dmm = new Dmm(client, { allowWrites: [{ pattern: "CONFigure:VOLTage:DC", anyArgs: true }] })
    const err = await dmm.write("CONF:VOLT:DC 10").catch((e: unknown) => e)
    assert.ok(err instanceof InstrumentError)
    assert.equal(err.code, "INSTRUMENT_ERROR")
    assert.deepEqual(err.errors, [{ code: -113, message: "Undefined header" }])
    assert.deepEqual(await dmm.errors(), [])
  })
})

test("malformed and over-range replies are refused, never turned into numbers", async () => {
  await withSim("dmm", async (sim, client) => {
    const dmm = new Dmm(client)
    sim.malformed = true
    await assert.rejects(dmm.voltageDc(), code("BAD_REPLY"))
    sim.malformed = false
    sim.dmm.voltage = 9.9e37
    await assert.rejects(dmm.voltageDc(), code("OVERLOAD"))
    sim.dmm.voltage = 5
    assert.ok((await dmm.voltageDc()).value > 4)
  })
})
