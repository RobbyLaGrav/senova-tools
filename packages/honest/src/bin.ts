#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Entry point for the `honest` command. All logic lives in cli.ts.
import { readFileSync } from "node:fs"

import { run } from "./cli.ts"

process.exitCode = run(process.argv.slice(2), {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  cwd: process.cwd(),
  stdin: () => readFileSync(0, "utf8"),
})
