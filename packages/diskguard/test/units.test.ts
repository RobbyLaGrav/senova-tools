// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { DiskguardInputError, formatBytes, parseDuration, parseSize, parseThreshold, thresholdBytes } from "../src/index.ts"
import { parseInt10 } from "../src/units.ts"

test("parseSize reads decimal and binary units", () => {
  assert.equal(parseSize("20GB"), 20e9)
  assert.equal(parseSize("20 gb"), 20e9)
  assert.equal(parseSize("20G"), 20e9)
  assert.equal(parseSize("1.5TB"), 1.5e12)
  assert.equal(parseSize("512MB"), 512e6)
  assert.equal(parseSize("1KiB"), 1024)
  assert.equal(parseSize("2GiB"), 2 * 1024 ** 3)
  assert.equal(parseSize("1048576"), 1048576)
  assert.equal(parseSize("0"), 0)
  assert.equal(parseSize(12345), 12345)
})

test("parseSize refuses anything it can't read exactly", () => {
  for (const bad of ["", " ", "GB", "-5GB", "20XB", "1e3GB", "20 G B", "20GB extra", "0x10", "NaN", "Infinity", "1,000MB", "99999999999999999999TB"]) {
    assert.throws(() => parseSize(bad), DiskguardInputError, bad)
  }
  assert.throws(() => parseSize(-1), DiskguardInputError)
  assert.throws(() => parseSize(Number.NaN), DiskguardInputError)
})

test("parseThreshold reads sizes and percentages", () => {
  assert.deepEqual(parseThreshold("10%"), { percent: 10 })
  assert.deepEqual(parseThreshold("12.5 %"), { percent: 12.5 })
  assert.deepEqual(parseThreshold("20GB"), { bytes: 20e9 })
  assert.deepEqual(parseThreshold({ percent: 5 }), { percent: 5 })
  assert.throws(() => parseThreshold("101%"), DiskguardInputError)
  assert.throws(() => parseThreshold("-1%"), DiskguardInputError)
  assert.throws(() => parseThreshold("%"), DiskguardInputError)
  assert.throws(() => parseThreshold({ percent: 200 }), DiskguardInputError)
  assert.equal(thresholdBytes({ percent: 10 }, 1000), 100)
  assert.equal(thresholdBytes({ bytes: 7 }, 1000), 7)
})

test("parseDuration needs a unit", () => {
  assert.equal(parseDuration("500ms"), 500)
  assert.equal(parseDuration("30s"), 30_000)
  assert.equal(parseDuration("10m"), 600_000)
  assert.equal(parseDuration("2h"), 7_200_000)
  assert.equal(parseDuration("1d"), 86_400_000)
  for (const bad of ["10", "", "m", "-5m", "10 years", "1e3s"]) assert.throws(() => parseDuration(bad), DiskguardInputError, bad)
})

test("parseInt10 accepts only whole numbers", () => {
  assert.equal(parseInt10("6", "--depth"), 6)
  for (const bad of ["-1", "1.5", "1e2", "", "six"]) assert.throws(() => parseInt10(bad, "--depth"), /--depth must be a whole number/)
})

test("formatBytes prints three significant figures in decimal units", () => {
  assert.equal(formatBytes(0), "0 B")
  assert.equal(formatBytes(999), "999 B")
  assert.equal(formatBytes(1234), "1.23 kB")
  assert.equal(formatBytes(20e9), "20.0 GB")
  assert.equal(formatBytes(512e6), "512 MB")
  assert.equal(formatBytes(3.2e12), "3.20 TB")
})
