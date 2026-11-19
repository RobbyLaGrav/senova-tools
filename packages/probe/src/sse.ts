// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A Server-Sent Events server on node:http, no dependencies. Bound to 127.0.0.1 unless told otherwise.
//   GET /         the viewer page
//   GET /events   text/event-stream of "measurement" events (id, JSON data); Last-Event-ID replays from history
//   GET /latest   JSON array with the latest measurement per (instrument, quantity), for scripts and agents
// While bound to a loopback address, requests whose Host header isn't a loopback name are refused, so a web page on
// another site can't reach the stream through DNS rebinding.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

import { invalid } from "./errors.ts"
import { validateMeasurement, type Measurement } from "./measurement.ts"
import { VIEWER_CSP, viewerHtml } from "./viewer.ts"

export interface SseServerOptions {
  /** Address to bind (default "127.0.0.1"). Anything else exposes live readings to your network. */
  host?: string
  /** Port (default 0: an ephemeral port; read it from the result). */
  port?: number
  /** Measurements kept for Last-Event-ID replay (default 500). */
  history?: number
  /** Most simultaneous /events subscribers (default 16). More get 503. */
  maxClients?: number
  /** Comment line sent to idle subscribers every heartbeatMs (default 15000). */
  heartbeatMs?: number
  /** Viewer page title (default "Probe"). */
  title?: string
}

export interface SseServer {
  readonly host: string
  readonly port: number
  /** "http://host:port/" */
  readonly url: string
  /** Number of connected /events subscribers. */
  readonly clients: number
  /** Validates and sends one measurement to every subscriber. Returns its event id. */
  publish(m: Measurement): number
  /** Disconnects every subscriber and stops listening. */
  close(): Promise<void>
}

const LOOPBACK_BIND = new Set(["127.0.0.1", "::1", "localhost"])
const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"])
const MAX_BUFFERED = 1 << 20

const int = (v: unknown, name: string, fallback: number, min: number): number => {
  if (v === undefined) return fallback
  if (!Number.isInteger(v) || (v as number) < min) throw invalid(`${name} must be an integer of at least ${min}`)
  return v as number
}

export async function startSseServer(options: SseServerOptions = {}): Promise<SseServer> {
  const host = options.host ?? "127.0.0.1"
  if (typeof host !== "string" || host === "") throw invalid("host must be a non-empty string")
  const port = int(options.port, "port", 0, 0)
  if (port > 65535) throw invalid("port must be at most 65535")
  const historySize = int(options.history, "history", 500, 0)
  const maxClients = int(options.maxClients, "maxClients", 16, 1)
  const heartbeatMs = int(options.heartbeatMs, "heartbeatMs", 15000, 100)
  const page = viewerHtml(options.title ?? "Probe")
  const checkHost = LOOPBACK_BIND.has(host)

  let nextId = 1
  const history: { id: number; data: string }[] = []
  const latest = new Map<string, Measurement>()
  const subscribers = new Set<ServerResponse>()

  const frame = (id: number, data: string) => `id: ${id}\nevent: measurement\ndata: ${data}\n\n`

  const send = (res: ServerResponse, chunk: string) => {
    // A subscriber that stops reading is dropped rather than buffered without bound.
    if (res.writableLength > MAX_BUFFERED) {
      subscribers.delete(res)
      res.destroy()
      return
    }
    res.write(chunk)
  }

  const hostAllowed = (req: IncomingMessage): boolean => {
    if (!checkHost) return true
    const h = (req.headers.host ?? "").toLowerCase()
    const name = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0]!
    return LOOPBACK_NAMES.has(name)
  }

  const reply = (res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}) => {
    res.writeHead(status, {
      "content-type": type,
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    })
    res.end(res.req.method === "HEAD" ? undefined : body)
  }

  const server = createServer((req, res) => {
    if (!hostAllowed(req)) return reply(res, 403, "text/plain; charset=utf-8", "Host not allowed\n")
    if (req.method !== "GET" && req.method !== "HEAD") {
      return reply(res, 405, "text/plain; charset=utf-8", "Method not allowed\n", { allow: "GET, HEAD" })
    }
    const url = new URL(req.url ?? "/", "http://localhost")
    if (url.pathname === "/") {
      return reply(res, 200, "text/html; charset=utf-8", page, {
        "content-security-policy": VIEWER_CSP,
        "referrer-policy": "no-referrer",
      })
    }
    if (url.pathname === "/latest") {
      return reply(res, 200, "application/json; charset=utf-8", `${JSON.stringify([...latest.values()])}\n`)
    }
    if (url.pathname !== "/events") return reply(res, 404, "text/plain; charset=utf-8", "Not found\n")
    if (subscribers.size >= maxClients) {
      return reply(res, 503, "text/plain; charset=utf-8", "Too many subscribers\n", { "retry-after": "5" })
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no",
    })
    if (req.method === "HEAD") return res.end()
    req.socket.setNoDelay(true)
    res.write("retry: 2000\n\n")
    const last = Number(req.headers["last-event-id"] ?? url.searchParams.get("lastEventId") ?? NaN)
    if (Number.isInteger(last) && last >= 0) {
      for (const h of history) if (h.id > last) res.write(frame(h.id, h.data))
    }
    subscribers.add(res)
    res.on("close", () => subscribers.delete(res))
  })

  const heartbeat = setInterval(() => {
    for (const res of subscribers) send(res, ": ping\n\n")
  }, heartbeatMs)
  heartbeat.unref()

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const addr = server.address() as AddressInfo
  const shownHost = addr.family === "IPv6" ? `[${addr.address}]` : addr.address

  return {
    host: addr.address,
    port: addr.port,
    url: `http://${shownHost}:${addr.port}/`,
    get clients() {
      return subscribers.size
    },
    publish(m: Measurement): number {
      const v = validateMeasurement(m)
      const id = nextId++
      const data = JSON.stringify({ quantity: v.quantity, value: v.value, unit: v.unit, t: v.t, instrument: v.instrument })
      latest.set(`${v.instrument}\u0000${v.quantity}`, v)
      if (historySize > 0) {
        history.push({ id, data })
        if (history.length > historySize) history.shift()
      }
      const chunk = frame(id, data)
      for (const res of subscribers) send(res, chunk)
      return id
    },
    close(): Promise<void> {
      clearInterval(heartbeat)
      for (const res of subscribers) res.end()
      subscribers.clear()
      return new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}
