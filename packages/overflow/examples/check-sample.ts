// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example through the API: check the sample snapshot with the sample config and print the
// report. Run: node examples/check-sample.ts (same output as `overflow check sample-snapshot.json -c overflow.config.json`).
import { readFileSync } from "node:fs"

import { check, fails, formatText, parseConfig, parseSnapshot } from "../src/index.ts"

const here = (name: string) => new URL(name, import.meta.url)
const snapshot = parseSnapshot(readFileSync(here("sample-snapshot.json"), "utf8"))
const config = parseConfig(readFileSync(here("overflow.config.json"), "utf8"))
const report = check(snapshot, config)
console.log(formatText(report))
process.exitCode = fails(report, config.failOn) ? 1 : 0
