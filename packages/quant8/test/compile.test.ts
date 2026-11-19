// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Compiles the generated C with a real compiler, runs it, and checks every output byte against the TypeScript
// interpreter. Uses $QUANT8_CC if set, else gcc, clang or cc from PATH; skips (with a message) when none is found.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import { argmaxInt8, generateC, INT32_MAX, parseModel, quantize, quantizeInput, runInt8, type QuantModel } from "../src/index.ts"
import { randomInputs, randomModelJson, rng } from "./helpers.ts"

function findCompiler(): string | undefined {
  const candidates = process.env.QUANT8_CC ? [process.env.QUANT8_CC] : ["gcc", "clang", "cc"]
  for (const cc of candidates) {
    const r = spawnSync(cc, ["--version"], { encoding: "utf8" })
    if (r.status === 0) return cc
  }
  return undefined
}

const cc = findCompiler()
const SKIP = cc === undefined ? "no C compiler found (set QUANT8_CC, or put gcc or clang on PATH) - C bit-exactness not checked" : false
const work = mkdtempSync(join(tmpdir(), "quant8-cc-"))
after(() => rmSync(work, { recursive: true, force: true }))

const FLAGS = ["-std=c99", "-pedantic", "-Wall", "-Wextra", "-Wconversion", "-Wsign-conversion", "-Wshadow", "-Werror", "-O2"]

/** Int8 test vectors: random over the full range, plus every-value-at-the-edge and the zero point. */
function int8Inputs(q: QuantModel, n: number, seed: number): number[][] {
  const r = rng(seed)
  const rows = Array.from({ length: n }, () => Array.from({ length: q.inputSize }, () => Math.floor(r() * 256) - 128))
  rows.push(new Array(q.inputSize).fill(-128), new Array(q.inputSize).fill(127), new Array(q.inputSize).fill(q.input.zeroPoint))
  return rows
}

/** Writes the model and a main.c that prints predict + argmax per int8 row, then quantize_input per float row. */
function build(q: QuantModel, name: string, ints: number[][], floats: number[][], noFloat: boolean): string[] {
  const dir = mkdtempSync(join(work, `${name}-`))
  const c = generateC(q, { name })
  writeFileSync(join(dir, c.headerName), c.header)
  writeFileSync(join(dir, c.sourceName), c.source)
  const N = name.toUpperCase()
  const main = `#include <stdio.h>
#include "${name}.h"
static const int8_t ints[${ints.length}][${N}_INPUT_SIZE] = {
${ints.map((row) => `    { ${row.join(", ")} }`).join(",\n")}
};
${noFloat ? "" : `static const float floats[${floats.length}][${N}_INPUT_SIZE] = {\n${floats.map((row) => `    { ${row.map((v) => `${v}f`).join(", ")} }`).join(",\n")}\n};`}
int main(void)
{
    int8_t out[${N}_OUTPUT_SIZE];
    int s, i;
    for (s = 0; s < ${ints.length}; s++) {
        ${name}_predict(ints[s], out);
        for (i = 0; i < ${N}_OUTPUT_SIZE; i++) printf("%d ", out[i]);
        printf("%d\\n", ${name}_argmax(out));
    }
${
  noFloat
    ? ""
    : `    for (s = 0; s < ${floats.length}; s++) {
        int8_t qx[${N}_INPUT_SIZE];
        ${name}_quantize_input(floats[s], qx);
        for (i = 0; i < ${N}_INPUT_SIZE; i++) printf("%d ", qx[i]);
        printf("\\n");
    }`
}
    return 0;
}
`
  writeFileSync(join(dir, "main.c"), main)
  const exe = join(dir, process.platform === "win32" ? "run.exe" : "run")
  const args = [...FLAGS, ...(noFloat ? [`-D${N}_NO_FLOAT`] : []), "-o", exe, join(dir, "main.c"), join(dir, c.sourceName), ...(noFloat ? [] : ["-lm"])]
  const compiled = spawnSync(cc!, args, { encoding: "utf8" })
  assert.equal(compiled.status, 0, `${cc} ${args.join(" ")}\n${compiled.stderr}`)
  const ran = spawnSync(exe, [], { encoding: "utf8" })
  assert.equal(ran.status, 0, ran.stderr)
  // Only the final newline goes: quantize_input lines end with a space that must stay.
  return ran.stdout.replace(/\r?\n$/, "").split(/\r?\n/)
}

function checkBitExact(q: QuantModel, name: string, seed: number, noFloat = false) {
  const ints = int8Inputs(q, 300, seed)
  const floats = noFloat ? [] : randomInputs(100, q.inputSize, seed + 1, -3, 3).map((row) => row.map(Math.fround))
  const lines = build(q, name, ints, floats, noFloat)
  assert.equal(lines.length, ints.length + floats.length)
  ints.forEach((x, s) => {
    const y = runInt8(q, x)
    assert.equal(lines[s], `${Array.from(y).join(" ")} ${argmaxInt8(y)}`, `${name} predict row ${s}`)
  })
  floats.forEach((x, s) => {
    assert.equal(lines[ints.length + s], Array.from(quantizeInput(q, x)).join(" ") + " ", `${name} quantize_input row ${s}`)
  })
}

const example = fileURLToPath(new URL("../examples/gesture/", import.meta.url))
const readJson = (f: string) => JSON.parse(readFileSync(join(example, f), "utf8"))

test("C matches the TypeScript interpreter bit for bit: README example (asymmetric)", { skip: SKIP }, () => {
  const q = quantize(parseModel(readJson("model.json")), readJson("calib.json").inputs)
  checkBitExact(q, "gesture", 1)
})

test("C matches bit for bit: wider random network, symmetric activations", { skip: SKIP }, () => {
  const q = quantize(parseModel(randomModelJson([12, 32, 20, 6], 31, true)), randomInputs(100, 12, 32), { scheme: "symmetric" })
  checkBitExact(q, "sym", 2)
})

test("C matches bit for bit: left shifts, saturating biases and zero multipliers", { skip: SKIP }, () => {
  const q = quantize(parseModel(randomModelJson([5, 9, 4], 41)), randomInputs(40, 5, 42))
  // Push the requantisation into its corners. The interpreter and the C read the same arrays, so they must still agree.
  const l0 = q.layers[0]!
  const absSum = (o: number) => Array.from(l0.weights.subarray(o * 5, o * 5 + 5)).reduce((s, w) => s + Math.abs(w), 0)
  l0.bias[0] = INT32_MAX - absSum(0) * 255
  l0.bias[1] = -(INT32_MAX - absSum(1) * 255)
  l0.shifts[2] = 30
  l0.shifts[3] = 12
  l0.shifts[4] = -31
  l0.multipliers[5] = 0
  l0.shifts[6] = 1
  l0.multipliers[6] = INT32_MAX
  checkBitExact(q, "edge", 3)
})

test("C compiles and matches with the float helpers left out (NO_FLOAT, no libm)", { skip: SKIP }, () => {
  const q = quantize(parseModel(randomModelJson([4, 3], 51, true)), randomInputs(20, 4, 52))
  checkBitExact(q, "intonly", 4, true)
})
