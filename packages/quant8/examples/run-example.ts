// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example. Run from packages/quant8: node examples/run-example.ts
// Same as: quant8 examples/gesture/model.json --calib examples/gesture/calib.json --test examples/gesture/test.json --out out --name gesture
import { main } from "../src/cli.ts"

process.exitCode = await main([
  "examples/gesture/model.json",
  "--calib",
  "examples/gesture/calib.json",
  "--test",
  "examples/gesture/test.json",
  "--out",
  "out",
  "--name",
  "gesture",
])
