// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { request, type IncomingMessage } from "node:http"
import { test } from "node:test"

import { measurement, startSseServer, VIEWER_CSP, type SseServer } from "../src/index.ts"

const m = (value: number, instrument = "dmm1") => measurement({ quantity: "voltage", value, t: 1000 + value, instrument })

function get(server: SseServer, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<{ res: IncomingMessage; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, method, headers }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (c: string) => (body += c))
      res.on("end", () => resolve({ res, body }))
    })
    req.on("error", reject)
    req.end()
  })
}

/** Opens /events and resolves with the raw stream text once `count` measurement events have arrived. */
function events(server: SseServer, count: number, headers: Record<string, string> = {}, onOpen?: () => void) {
  return new Promise<{ res: IncomingMessage; text: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path: "/events", headers }, (res) => {
      let text = ""
      res.setEncoding("utf8")
      onOpen?.()
      res.on("data", (c: string) => {
        text += c
        if ((text.match(/event: measurement/g) ?? []).length >= count) {
          req.destroy()
          resolve({ res, text })
        }
      })
    })
    req.on("error", (e) => (e.message === "socket hang up" ? undefined : reject(e)))
    req.end()
  })
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
  assert.ok(cond())
}

test("binds to 127.0.0.1 on an ephemeral port by default and serves the viewer with a strict CSP", async () => {
  const server = await startSseServer({ title: "Bench <A>" })
  try {
    assert.equal(server.host, "127.0.0.1")
    assert.ok(server.port > 0)
    assert.equal(server.url, `http://127.0.0.1:${server.port}/`)
    const { res, body } = await get(server, "/")
    assert.equal(res.statusCode, 200)
    assert.match(String(res.headers["content-type"]), /text\/html/)
    assert.equal(res.headers["content-security-policy"], VIEWER_CSP)
    assert.match(VIEWER_CSP, /default-src 'none'/)
    assert.doesNotMatch(VIEWER_CSP, /unsafe-inline/)
    assert.match(body, /<title>Bench &lt;A&gt;<\/title>/)
    assert.match(body, /new EventSource\("events"\)/)
    assert.doesNotMatch(body, /(src|href)="http/)
  } finally {
    await server.close()
  }
})

test("/events streams typed measurement events with ids", async () => {
  const server = await startSseServer()
  try {
    const stream = events(server, 2)
    await waitFor(() => server.clients === 1)
    assert.equal(server.publish(m(1)), 1)
    assert.equal(server.publish(m(2)), 2)
    const { res, text } = await stream
    assert.match(String(res.headers["content-type"]), /text\/event-stream/)
    assert.equal(res.headers["cache-control"], "no-store")
    const frames = text.split("\n\n").filter((f) => f.includes("event: measurement"))
    assert.deepEqual(frames, [
      'id: 1\nevent: measurement\ndata: {"quantity":"voltage","value":1,"unit":"V","t":1001,"instrument":"dmm1"}',
      'id: 2\nevent: measurement\ndata: {"quantity":"voltage","value":2,"unit":"V","t":1002,"instrument":"dmm1"}',
    ])
    assert.ok(text.startsWith("retry: 2000\n\n"))
    await waitFor(() => server.clients === 0)
  } finally {
    await server.close()
  }
})

test("Last-Event-ID replays what was missed; /latest has one row per instrument and quantity", async () => {
  const server = await startSseServer({ history: 3 })
  try {
    for (let i = 1; i <= 5; i++) server.publish(m(i))
    server.publish(m(9, "dmm2"))
    const { text } = await events(server, 2, { "last-event-id": "4" })
    assert.match(text, /id: 5\n/)
    assert.match(text, /id: 6\n/)
    assert.doesNotMatch(text, /id: 4\n/)
    const { body } = await get(server, "/latest")
    const latest = JSON.parse(body) as { instrument: string; value: number }[]
    assert.deepEqual(latest.map((x) => [x.instrument, x.value]), [["dmm1", 5], ["dmm2", 9]])
    assert.throws(() => server.publish({ ...m(1), unit: "mV" } as never), /must be in V/)
  } finally {
    await server.close()
  }
})

test("refuses foreign Host headers, other methods, unknown paths and too many subscribers", async () => {
  const server = await startSseServer({ maxClients: 1 })
  try {
    assert.equal((await get(server, "/", { host: "evil.example:80" })).res.statusCode, 403)
    assert.equal((await get(server, "/latest", { host: `localhost:${server.port}` })).res.statusCode, 200)
    assert.equal((await get(server, "/", {}, "POST")).res.statusCode, 405)
    assert.equal((await get(server, "/nope")).res.statusCode, 404)
    const first = events(server, 1)
    await waitFor(() => server.clients === 1)
    assert.equal((await get(server, "/events")).res.statusCode, 503)
    server.publish(m(1))
    await first
  } finally {
    await server.close()
  }
  await assert.rejects(startSseServer({ port: 70000 }), /port/)
  await assert.rejects(startSseServer({ history: -1 }), /history/)
})

test("close() ends open streams", async () => {
  const server = await startSseServer()
  const ended = new Promise<void>((resolve) => {
    request({ host: "127.0.0.1", port: server.port, path: "/events" }, (res) => {
      res.resume()
      res.on("end", resolve)
    }).end()
  })
  await waitFor(() => server.clients === 1)
  await server.close()
  await ended
})
