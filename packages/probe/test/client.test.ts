// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer, type Server, type Socket } from "node:net"
import type { AddressInfo } from "node:net"
import { test } from "node:test"

import { ProbeError, ScpiClient, startSimulator } from "../src/index.ts"

const code = (c: string) => (err: unknown) => err instanceof ProbeError && err.code === c

/** A raw TCP server for cases the simulator doesn't cover; `onLine` returns the reply (or nothing). */
async function rawServer(onLine: (line: string, socket: Socket) => string | undefined): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    let buf = ""
    socket.on("error", () => {})
    socket.on("data", (c) => {
      buf += c.toString()
      let nl: number
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        const out = onLine(line, socket)
        if (out !== undefined) socket.write(out)
      }
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return { server, port: (server.address() as AddressInfo).port }
}
const closeServer = (server: Server) => {
  server.closeAllConnections?.()
  return new Promise<void>((r) => server.close(() => r()))
}

test("query/response against the simulator, with \\r\\n tolerated", async () => {
  const sim = await startSimulator({ kind: "dmm" })
  const client = new ScpiClient({ port: sim.port })
  try {
    await client.connect()
    assert.equal(client.state, "connected")
    assert.equal(await client.query("*IDN?"), "Probe,SIM-DMM,SIM0001,1.0")
    const v = Number(await client.query("MEAS:VOLT:DC?"))
    assert.ok(Math.abs(v - 5) < 0.05, String(v))
    await client.write("*CLS")
    assert.deepEqual(await client.errors(), [])
  } finally {
    await client.close()
    await sim.close()
  }
  const { server, port } = await rawServer(() => "+1.5E+00\r\n")
  const c2 = new ScpiClient({ port })
  assert.equal(await c2.query("MEAS?"), "+1.5E+00")
  await c2.close()
  await closeServer(server)
})

test("one command in flight: concurrent queries are sent one after another and get their own replies", async () => {
  let outstanding = 0
  let overlapped = false
  const { server, port } = await rawServer((line, socket) => {
    if (outstanding > 0) overlapped = true
    outstanding++
    setTimeout(() => {
      outstanding--
      socket.write(`${line.replace("?", "")}-reply\n`)
    }, 15)
    return undefined
  })
  const client = new ScpiClient({ port })
  const replies = await Promise.all(["A?", "B?", "C?", "D?"].map((q) => client.query(q)))
  assert.deepEqual(replies, ["A-reply", "B-reply", "C-reply", "D-reply"])
  assert.equal(overlapped, false)
  await client.close()
  await closeServer(server)
})

test("a silent instrument times out, the connection is reset, and the next query works", async () => {
  const sim = await startSimulator()
  const client = new ScpiClient({ port: sim.port, timeoutMs: 100, reconnect: { initialMs: 10, maxMs: 20 } })
  try {
    await client.connect()
    sim.silent = true
    const t0 = Date.now()
    await assert.rejects(client.query("MEAS:VOLT:DC?"), code("TIMEOUT"))
    assert.ok(Date.now() - t0 >= 90)
    assert.equal(client.stats.timeouts, 1)
    sim.silent = false
    // The late reply can't be mistaken for this one: the timed-out connection was closed and reopened.
    assert.equal(await client.query("*IDN?"), "Probe,SIM-DMM,SIM0001,1.0")
    assert.ok(client.stats.connects >= 2)
    // Per-command timeout override.
    sim.replyDelayMs = 80
    await assert.rejects(client.query("*IDN?", { timeoutMs: 20 }), code("TIMEOUT"))
  } finally {
    await client.close()
    await sim.close()
  }
})

test("reconnects with backoff after the simulator drops the connection", async () => {
  const sim = await startSimulator()
  const client = new ScpiClient({ port: sim.port, reconnect: { initialMs: 20, maxMs: 50 } })
  const events: string[] = []
  client.on("disconnect", () => events.push("disconnect"))
  client.on("reconnecting", () => events.push("reconnecting"))
  client.on("connect", () => events.push("connect"))
  try {
    await client.connect()
    sim.dropConnections()
    await once(client, "disconnect")
    assert.equal(await client.query("*IDN?"), "Probe,SIM-DMM,SIM0001,1.0")
    assert.deepEqual(events.slice(0, 4), ["connect", "disconnect", "reconnecting", "connect"])
    assert.equal(client.stats.drops, 1)
  } finally {
    await client.close()
    await sim.close()
  }
})

test("reconnects when the instrument comes back on the same port, and queued commands wait for it", async () => {
  const sim = await startSimulator()
  const port = sim.port
  const client = new ScpiClient({ port, timeoutMs: 3000, reconnect: { initialMs: 20, maxMs: 40 } })
  await client.connect()
  await sim.close()
  await once(client, "disconnect")
  const pending = client.query("*IDN?")
  await new Promise((r) => setTimeout(r, 100))
  assert.notEqual(client.state, "connected")
  const sim2 = await startSimulator({ port, idn: "Probe,SIM-DMM,SIM0001,2.0" })
  try {
    assert.equal(await pending, "Probe,SIM-DMM,SIM0001,2.0")
  } finally {
    await client.close()
    await sim2.close()
  }
})

test("a query in flight when the connection drops fails with CONNECTION", async () => {
  const sim = await startSimulator({ replyDelayMs: 200 })
  const client = new ScpiClient({ port: sim.port, reconnect: { initialMs: 10 } })
  try {
    await client.connect()
    const q = client.query("*IDN?")
    await new Promise((r) => setTimeout(r, 30))
    sim.dropConnections()
    await assert.rejects(q, code("CONNECTION"))
  } finally {
    await client.close()
    await sim.close()
  }
})

test("without reconnect, or after maxAttempts, commands fail instead of waiting", async () => {
  const sim = await startSimulator()
  const port = sim.port
  await sim.close()
  const noRetry = new ScpiClient({ port, reconnect: false })
  await assert.rejects(noRetry.connect(), code("CONNECTION"))
  await assert.rejects(noRetry.query("*IDN?"), code("CONNECTION"))
  await noRetry.close()

  const limited = new ScpiClient({ port, reconnect: { initialMs: 5, maxMs: 10, maxAttempts: 2 } })
  const giveup = once(limited, "giveup")
  await assert.rejects(limited.query("*IDN?"), code("CONNECTION"))
  await giveup
  await limited.close()

  const timed = new ScpiClient({ port, reconnect: { initialMs: 5, maxMs: 10 } })
  await assert.rejects(timed.connect({ timeoutMs: 100 }), code("CONNECTION"))
  await timed.close()
})

test("closed clients, misused query/write, bad commands and a full queue are refused", async () => {
  const sim = await startSimulator({ replyDelayMs: 50 })
  const client = new ScpiClient({ port: sim.port, maxQueue: 2 })
  await assert.rejects(client.query("*IDN"), code("INVALID_COMMAND"))
  await assert.rejects(client.write("*IDN?"), code("INVALID_COMMAND"))
  await assert.rejects(client.write("VOLT 1\nOUTP ON"), code("INVALID_COMMAND"))
  const first = client.query("*IDN?")
  const queued = [client.query("*IDN?"), client.query("*IDN?")]
  await assert.rejects(client.query("*IDN?"), code("QUEUE_FULL"))
  await Promise.all([first, ...queued])
  await client.close()
  assert.equal(client.state, "closed")
  await assert.rejects(client.query("*IDN?"), code("CLOSED"))
  await assert.rejects(client.connect(), code("CLOSED"))
  assert.equal(sim.received.includes("VOLT 1"), false)
  await sim.close()
  assert.throws(() => new ScpiClient({ port: 70000 }), code("INVALID_ARGUMENT"))
  assert.throws(() => new ScpiClient({ timeoutMs: 0 }), code("INVALID_ARGUMENT"))
})

test("close() fails queued commands with CLOSED", async () => {
  const sim = await startSimulator({ replyDelayMs: 200 })
  const client = new ScpiClient({ port: sim.port })
  const a = client.query("*IDN?")
  const b = client.query("*IDN?")
  await new Promise((r) => setTimeout(r, 50))
  await client.close()
  await assert.rejects(a, code("CLOSED"))
  await assert.rejects(b, code("CLOSED"))
  await sim.close()
})

test("error queue: SYST:ERR? is read until 0, and malformed replies are BAD_REPLY", async () => {
  const sim = await startSimulator()
  const client = new ScpiClient({ port: sim.port })
  try {
    await client.write("BOGUS:CMD 1")
    await client.write("MEAS:VOLT:DC")
    assert.deepEqual(await client.errors(), [
      { code: -113, message: "Undefined header" },
      { code: -113, message: "Undefined header" },
    ])
    assert.deepEqual(await client.errors(), [])
  } finally {
    await client.close()
    await sim.close()
  }
  const { server, port } = await rawServer(() => "no error here\n")
  const c2 = new ScpiClient({ port })
  await assert.rejects(c2.errors(), code("BAD_REPLY"))
  await c2.close()
  await closeServer(server)
})

test("a reply longer than maxLineLength with no newline is BAD_REPLY and resets the connection", async () => {
  const { server, port } = await rawServer((line) => (line === "BIG?" ? "x".repeat(5000) : "ok\n"))
  const client = new ScpiClient({ port, maxLineLength: 1024, reconnect: { initialMs: 10 } })
  try {
    await assert.rejects(client.query("BIG?"), code("BAD_REPLY"))
    assert.equal(await client.query("SMALL?"), "ok")
  } finally {
    await client.close()
    await closeServer(server)
  }
})

test("lines nobody asked for are reported as unsolicited, not handed to the next query", async () => {
  const { server, port } = await rawServer((line, socket) => {
    if (line === "PUSH") socket.write("surprise\n")
    return line === "Q?" ? "answer\n" : undefined
  })
  const client = new ScpiClient({ port })
  try {
    const seen: string[] = []
    client.on("unsolicited", (l: string) => seen.push(l))
    await client.write("PUSH")
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(await client.query("Q?"), "answer")
    assert.deepEqual(seen, ["surprise"])
  } finally {
    await client.close()
    await closeServer(server)
  }
})
