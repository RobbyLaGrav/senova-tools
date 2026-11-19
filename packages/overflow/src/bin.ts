#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The `overflow` command. All the logic is in cli.ts, so tests can call it without a child process.
import { main } from "./cli.ts"

process.exitCode = main(process.argv.slice(2))
