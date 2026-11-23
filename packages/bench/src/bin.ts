#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The `bench` command. All the logic is in cli.ts, so tests can call it without a child process.
import { main } from "./cli.ts"

const stop = new AbortController()
process.once("SIGINT", () => stop.abort())
process.once("SIGTERM", () => stop.abort())
process.exitCode = await main(process.argv.slice(2), undefined, stop.signal)
