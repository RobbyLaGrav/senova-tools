// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README example: a simulated power supply and multimeter, polled five times a second, streamed to a live page
// and recorded to JSONL. No hardware needed.
// Run: node examples/bench.ts [seconds=10] [recording=bench.jsonl]
import { Dmm, JsonlRecorder, Poller, Psu, ScpiClient, startSimulator, startSseServer } from "../src/index.ts"

const seconds = Number(process.argv[2] ?? 10)
const file = process.argv[3] ?? "bench.jsonl"

// Two simulated instruments on 127.0.0.1. Swap the ports (and host) for real ones.
const psuSim = await startSimulator({ kind: "psu", seed: 7 })
const dmmSim = await startSimulator({ kind: "dmm", seed: 8 })

const psu = new Psu(new ScpiClient({ port: psuSim.port }), { name: "psu1", limits: { maxVoltage: 12, maxCurrent: 1 } })
const dmm = new Dmm(new ScpiClient({ port: dmmSim.port }), { name: "dmm1" })

console.log(await psu.identify()) // { manufacturer: 'Probe', model: 'SIM-PSU', serial: 'SIM0002', firmware: '1.0' }
await psu.setCurrent(0.5)
await psu.setVoltage(3.3)
await psu.output(true)
await psu.setVoltage(48).catch((e) => console.log(e.code, e.message)) // LIMIT_EXCEEDED, never sent

const sse = await startSseServer({ port: Number(process.env.PORT ?? 0) })
const recorder = new JsonlRecorder(file)
const poller = new Poller({
  intervalMs: 200,
  read: async () => [await psu.measureVoltage(), await psu.measureCurrent(), await dmm.voltageDc()],
  onMeasurement: (m) => {
    sse.publish(m)
    recorder.write(m)
  },
  onError: (e) => console.error(e.message),
}).start()
console.log(`Live page: ${sse.url}  (events: ${sse.url}events, latest: ${sse.url}latest)`)

const shutdown = async () => {
  await poller.stop()
  await psu.output(false)
  await Promise.all([psu.client.close(), dmm.client.close(), recorder.close(), sse.close()])
  await Promise.all([psuSim.close(), dmmSim.close()])
  console.log(`${recorder.lines} measurements in ${file}; ${poller.stats.skipped} ticks skipped`)
}
const timer = setTimeout(shutdown, seconds * 1000)
process.once("SIGINT", () => {
  clearTimeout(timer)
  void shutdown()
})
