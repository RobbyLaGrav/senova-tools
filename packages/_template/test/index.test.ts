// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { hello } from "../src/index.ts"

test("hello greets by name", () => {
  assert.equal(hello("world"), "Hello, world")
})
