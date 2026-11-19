// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Probe: bench instruments that stream live, typed measurements to a page, a script or an agent. SCPI over TCP,
// typed DMM and power-supply drivers behind an allow list and limits, a polling scheduler with backpressure, a
// Server-Sent Events server with a viewer page, a JSONL recorder and a SCPI simulator. No dependencies.

export { ProbeError, InstrumentError, type ProbeErrorCode, type InstrumentErrorEntry } from "./errors.ts"
export {
  ScpiClient,
  type ScpiClientOptions,
  type ReconnectOptions,
  type CommandOptions,
  type ClientState,
} from "./client.ts"
export {
  validateCommand,
  parseCommand,
  compilePattern,
  matchHeader,
  matches,
  MAX_COMMAND_LENGTH,
  type ParsedCommand,
  type HeaderPattern,
} from "./syntax.ts"
export { CommandGuard, type WriteRule, type GuardOptions } from "./guard.ts"
export {
  SI_UNITS,
  SCPI_OVERLOAD,
  measurement,
  validateMeasurement,
  parseScpiNumber,
  type Measurement,
  type Quantity,
  type SiUnit,
} from "./measurement.ts"
export {
  Instrument,
  Dmm,
  Psu,
  COMMON_QUERIES,
  type Identity,
  type InstrumentOptions,
  type PsuOptions,
  type PsuLimits,
} from "./drivers.ts"
export { Poller, type PollerOptions, type PollerStats, type PollRead } from "./poller.ts"
export { startSseServer, type SseServer, type SseServerOptions } from "./sse.ts"
export { viewerHtml, VIEWER_CSP } from "./viewer.ts"
export { JsonlRecorder, readRecording } from "./recorder.ts"
export { startSimulator, type Simulator, type SimulatorOptions, type PsuState } from "./simulator.ts"
