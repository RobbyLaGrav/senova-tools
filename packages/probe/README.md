# Probe

Bench instruments that stream live, typed measurements to a page, a script or an agent.

**For:** hardware engineers and test labs who want readings from SCPI instruments (multimeters, power supplies) in a browser tab, a JSONL file or a program, without vendor software. **Status:** in progress (0.x: the API may change before 1.0).

- **SCPI over TCP.** Talks to instruments on their raw-socket port (5025 by default) with node:net: newline framing, one command in flight, a timeout on every command, reconnect with backoff, and error-queue reads (`SYST:ERR?`).
- **Typed drivers with a guard.** A generic instrument (`*IDN?`), a DMM and a power supply. Every command is checked against an allow list before it is sent, and power-supply setpoints above the limits you configure are refused before they reach the socket.
- **Typed measurements.** `{ quantity, value, unit, t, instrument }`, with the unit checked against the quantity's SI unit. Over-range (9.9E37) and garbled replies throw instead of becoming numbers.
- **Polling with backpressure.** Reads never overlap; when one is slow, missed ticks are skipped or folded into one catch-up read.
- **Live out.** A Server-Sent Events server (127.0.0.1 by default) with a small viewer page, a `/latest` JSON endpoint for scripts and agents, and a JSONL recorder.
- **A simulator.** A noisy SCPI DMM or power supply on a TCP port, so the example and the tests run without hardware.

## Install

```sh
npm install @senova/probe
```

Not on npm yet: until it is, clone this repository and run `npm install` at its root. Node.js 24 or newer; the TypeScript sources run directly.

## Two-minute example

[`examples/bench.ts`](examples/bench.ts) starts a simulated power supply and multimeter, sets the supply to 3.3 V, polls both five times a second, and streams the readings to a page and a JSONL file. It imports from `../src/index.ts` so it runs inside this repository; outside it, import from `@senova/probe`.

```ts
import { Dmm, JsonlRecorder, Poller, Psu, ScpiClient, startSimulator, startSseServer } from "@senova/probe"

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

const sse = await startSseServer({ port: 8080 })
const recorder = new JsonlRecorder("bench.jsonl")
const poller = new Poller({
  intervalMs: 200,
  read: async () => [await psu.measureVoltage(), await psu.measureCurrent(), await dmm.voltageDc()],
  onMeasurement: (m) => {
    sse.publish(m)
    recorder.write(m)
  },
  onError: (e) => console.error(e.message),
}).start()
console.log(`Live page: ${sse.url}`)
```

Run it from `packages/probe` (it stops after the given number of seconds, or on Ctrl+C):

```sh
PORT=8080 node examples/bench.ts 30 bench.jsonl
```

Open `http://127.0.0.1:8080/` to watch the values and sparklines update. Each line of `bench.jsonl` is one reading:

```json
{"quantity":"voltage","value":3.30455297,"unit":"V","t":1795049416276,"instrument":"psu1"}
```

From a script or an agent, read the stream with any SSE client (`curl -N http://127.0.0.1:8080/events`) or take a snapshot with `curl http://127.0.0.1:8080/latest`.

To use a real instrument, point a client at it: `new ScpiClient({ host: "192.168.1.50" })` (port 5025 unless the manual says otherwise).

## API

Everything throws `ProbeError` with a stable `code`: `INVALID_ARGUMENT`, `INVALID_COMMAND`, `TIMEOUT`, `CONNECTION`, `CLOSED`, `QUEUE_FULL`, `BAD_REPLY`, `OVERLOAD`, `INSTRUMENT_ERROR`, `WRITE_REFUSED`, `LIMIT_EXCEEDED`, `UNIT`.

### `new ScpiClient(options?)`

| Option | Default | |
| --- | --- | --- |
| `host` | `"127.0.0.1"` | |
| `port` | `5025` | |
| `timeoutMs` | `2000` | per command; override per call with `{ timeoutMs }` |
| `connectTimeoutMs` | `3000` | one TCP connect attempt |
| `reconnect` | `true` | `false`, or `{ initialMs: 100, maxMs: 5000, factor: 2, maxAttempts: Infinity }` |
| `maxQueue` | `64` | more waiting commands are refused with `QUEUE_FULL` |
| `maxLineLength` | `65536` | a longer reply closes the connection with `BAD_REPLY` |

- `connect({ timeoutMs = 10000 }?)`: connects, or waits for the reconnect in progress. Commands also connect on first use.
- `query(command, { timeoutMs }?) → Promise<string>`: sends a query (header ends in `?`) and resolves with the reply line.
- `write(command, { timeoutMs }?) → Promise<void>`: sends a command with no reply.
- `errors() → Promise<{ code, message }[]>`: reads `SYST:ERR?` until it reports 0.
- `close()`: stops reconnecting; queued commands fail with `CLOSED`.
- `state` (`idle`, `connecting`, `connected`, `waiting`, `closed`), `address`, `stats` (`sent`, `timeouts`, `connects`, `drops`, `unsolicited`).
- Events: `connect`, `disconnect`, `reconnecting` (`{ attempt, delayMs }`), `giveup`, `unsolicited` (a line no query was waiting for).

Commands are checked before they are queued: printable ASCII, at most 512 characters, no newlines and no `;` compound commands. A query that times out closes the connection on purpose and reconnects, so its late reply can't be read as the answer to the next query. While disconnected, a queued command waits at most its own timeout.

### Drivers

- `new Instrument(client, options?)`: `identify()` (parses `*IDN?` into `{ manufacturer, model, serial, firmware }`), `query(command)`, `write(command)`, `errors()`, `measure(command, quantity)`.
- `new Dmm(client, options?)`: `voltageDc()` (`MEAS:VOLT:DC?`), `currentDc()` (`MEAS:CURR:DC?`), `resistance()` (`MEAS:RES?`), each a `Measurement`.
- `new Psu(client, { limits: { maxVoltage, maxCurrent }, ...options })`: `setVoltage(volts)`, `setCurrent(amps)`, `output(on)`, `outputState()`, `measureVoltage()`, `measureCurrent()`. The limits are required.

`InstrumentOptions`: `name` (carried by every measurement; default the client's `host:port`), `checkErrors` (default `true`: read the error queue after every write and throw `InstrumentError` with the entries), `allowWrites` (extra `WriteRule`s), `allowQueries` (extra query patterns).

Every driver allows `*IDN?`, `*OPC?`, `*STB?`, `*ESR?` and `SYST:ERR?`, plus its own commands. Anything else is refused with `WRITE_REFUSED` before it is sent, including queries, since some act (`*CAL?` runs a calibration).

### `new CommandGuard({ writes?, queries? })`

The allow list behind every driver (`instrument.guard`). Patterns are written the way manuals write them: the uppercase part is the short form, square brackets are optional nodes, so `"[SOURce:]VOLTage[:LEVel]"` accepts `VOLT 5`, `sour:volt:lev 5` and `SOURCE:VOLTAGE 5`.

A `WriteRule` is `{ pattern, limit?: { max, min = 0, quantity? }, values?: string[], anyArgs?: boolean }`. With `limit`, the argument must be one plain number in range (`MAX`, `DEF` and unit suffixes are refused); with `values`, one of those words; with neither, no argument unless `anyArgs`. When several rules match a write, it must satisfy all of them, so adding a looser rule can't widen a limit. `checkWrite(command)` and `checkQuery(command)` throw or return the parsed command.

Also exported: `validateCommand`, `parseCommand`, `compilePattern`, `matchHeader`, `matches`.

### Measurements

`Measurement` is `{ quantity, value, unit, t, instrument }`: `t` is milliseconds since the epoch, taken when the reply arrived. `SI_UNITS` maps each quantity to its unit: voltage V, current A, resistance Ω, power W, frequency Hz, capacitance F, temperature K, time s.

- `measurement({ quantity, value, unit?, t?, instrument })`: builds one, filling in the SI unit and the time.
- `validateMeasurement(value)`: checks an untrusted object (for example a parsed JSONL line) and returns a clean copy.
- `parseScpiNumber(reply)`: NR1/NR2/NR3 numbers only; `9.9E37` throws `OVERLOAD`.

### `new Poller({ intervalMs, read, onMeasurement?, onError?, overrun? })`

Calls `read()` (returning one measurement or an array) every `intervalMs` (at least 10). `overrun: "skip"` (default) drops ticks that arrive while a read is running; `"coalesce"` runs one catch-up read as soon as it finishes. Errors go to `onError` and polling continues. `start()`, `stop()` (resolves after the read in progress is delivered), `running`, `stats` (`ticks`, `reads`, `measurements`, `skipped`, `coalesced`, `errors`), `lastError`.

### `startSseServer(options?) → Promise<SseServer>`

Options: `host` (`"127.0.0.1"`), `port` (`0`: ephemeral), `history` (`500` events kept for `Last-Event-ID` replay), `maxClients` (`16`), `heartbeatMs` (`15000`), `title`. Returns `{ host, port, url, clients, publish(m), close() }`.

- `GET /`: the viewer page (one HTML file, no external requests, a Content-Security-Policy that allows only its own script and style).
- `GET /events`: `text/event-stream`; each reading is `id: n`, `event: measurement`, `data: <JSON>`.
- `GET /latest`: the latest reading per instrument and quantity as a JSON array.

While bound to a loopback address it refuses requests whose `Host` header isn't `127.0.0.1`, `localhost` or `[::1]`, so other websites can't read it through DNS rebinding. A subscriber that stops reading is dropped once 1 MiB is buffered for it.

### `new JsonlRecorder(path)` and `readRecording(path)`

`write(m)` validates and appends one line; `close()` flushes. `readRecording` returns the typed measurements, ignoring a torn last line from a killed run and naming the line number of anything else that's wrong.

### `startSimulator(options?) → Promise<Simulator>`

A SCPI instrument on a TCP port: `kind` (`"dmm"` or `"psu"`), `host` (`"127.0.0.1"`), `port` (`0`), `seed`, `noise` (standard deviation as a fraction of the reading, default 0.0005), `idn`, `dmm` (`{ voltage: 5, current: 0.1, resistance: 1000 }`), `psu` (`{ maxVoltage: 30, maxCurrent: 3, loadOhms: 10 }`), `replyDelayMs`. The power supply drives a resistive load and current-limits like a bench supply. It keeps an error queue (`-113` undefined header, `-222` out of range, ...). For tests: `received`, `connections`, `psu`, `dmm`, and the switches `replyDelayMs`, `silent` (never answer queries), `malformed` (garbled readings), `dropConnections()`; `close()`.

## Limits

- **TCP raw sockets only.** Serial (RS-232), USBTMC, VXI-11 and HiSLIP are not supported yet, so instruments with only USB or GPIB can't be reached directly.
- **Two driver types.** DMM DC voltage, DC current and resistance; power-supply voltage, current and output on a single channel. Other functions (AC, ranges, triggering, multi-channel supplies) need `allowWrites` / `allowQueries` on the generic driver.
- **Command dialects differ.** The drivers send common SCPI forms (`MEAS:VOLT:DC?`, `VOLT 5`, `OUTP ON`). Check them against your instrument's manual; some models need different headers.
- **One reply line per query.** Definite-length binary blocks (`#...`, used for waveforms and screenshots) are not parsed.
- **Timestamps are host time** when the reply arrived, not the instrument's acquisition time.
- **The limits are a software guard.** They stop this library from sending a setpoint above them; they don't replace the instrument's own protection (OVP/OCP) or changes made on the front panel.
- **The simulator's readings are simulated**, with Gaussian noise and an ideal resistive load, not measured.
- **The viewer has no sign-in.** Keep it on 127.0.0.1 (the default); binding to another address shares live readings with that network.

## Dependencies

None. Node.js built-ins only (`node:net`, `node:http`, `node:fs`, `node:events`, `node:crypto`).

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
