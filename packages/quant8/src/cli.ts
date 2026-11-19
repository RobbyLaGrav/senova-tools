// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"

import { quant8, type Quant8Result } from "./index.ts"
import { Quant8Error } from "./model.ts"

export const USAGE = `quant8: quantise a small dense network to int8 and generate C99 for a microcontroller.

Usage:
  quant8 <model.json> --calib <samples.json> --out <dir> [options]

Writes <dir>/<name>.h, <dir>/<name>.c and <dir>/<name>.report.json, and prints a summary.

Options:
      --calib <file>   calibration samples: [[...], ...] or {"inputs": [[...]], "labels": [...]} (required)
      --test <file>    samples for the accuracy report (default: the calibration samples)
      --out <dir>      output directory, created if missing (required)
      --name <id>      C prefix and file name (default: model)
      --symmetric      symmetric activations (zero point 0) instead of asymmetric
      --json           print the report as JSON instead of the summary
  -h, --help           this help`

/** Where the CLI writes. Tests pass their own. */
export interface CliIo {
  stdout(line: string): void
  stderr(line: string): void
  cwd: string
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(line + "\n"),
  stderr: (line) => process.stderr.write(line + "\n"),
  cwd: process.cwd(),
}

function readJson(path: string, what: string): unknown {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (err) {
    throw new Quant8Error(`cannot read ${what} file ${path}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`)
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Quant8Error(`${what} file ${path} is not valid JSON: ${(err as Error).message}`)
  }
}

/** The JSON report written next to the C files. */
export function reportJson(r: Quant8Result): object {
  const q = r.quantized
  return {
    scheme: q.scheme,
    inputSize: q.inputSize,
    outputSize: q.layers.at(-1)!.outputs,
    softmax: q.softmax,
    input: q.input,
    output: q.output,
    layers: q.layers.map((l) => ({
      inputs: l.inputs,
      outputs: l.outputs,
      activation: l.activation,
      input: l.input,
      output: l.output,
      actMin: l.actMin,
      weightScales: l.weightScales,
    })),
    memory: r.memory,
    accuracy: r.accuracy,
  }
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`

/** Runs the CLI with the given arguments (without `node` and the script) and returns the exit code. */
export async function main(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  let args
  try {
    args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        calib: { type: "string" },
        test: { type: "string" },
        out: { type: "string" },
        name: { type: "string" },
        symmetric: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    })
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = args
  if (values.help) {
    io.stdout(USAGE)
    return 0
  }
  if (positionals.length !== 1 || values.calib === undefined || values.out === undefined) {
    io.stderr(`${positionals.length > 1 ? "expected one model file" : "missing the model file, --calib or --out"}\n\n${USAGE}`)
    return 2
  }
  try {
    const modelPath = resolve(io.cwd, positionals[0]!)
    const model = readJson(modelPath, "model")
    const calib = readJson(resolve(io.cwd, values.calib), "calibration")
    const test = values.test !== undefined ? readJson(resolve(io.cwd, values.test), "test") : undefined
    const r = quant8(model, calib, {
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.symmetric ? { scheme: "symmetric" as const } : {}),
      ...(test !== undefined ? { test } : {}),
    })
    const out = resolve(io.cwd, values.out)
    mkdirSync(out, { recursive: true })
    const name = r.c.headerName.slice(0, -2)
    const report = reportJson(r)
    writeFileSync(join(out, r.c.headerName), r.c.header)
    writeFileSync(join(out, r.c.sourceName), r.c.source)
    writeFileSync(join(out, `${name}.report.json`), JSON.stringify(report, null, 2) + "\n")
    if (values.json) {
      io.stdout(JSON.stringify(report, null, 2))
      return 0
    }
    const a = r.accuracy
    const show = (f: string) => relative(io.cwd, join(out, f)) || f
    io.stdout(
      [
        `${r.quantized.inputSize} -> ${r.quantized.layers.map((l) => l.outputs).join(" -> ")}${r.quantized.softmax ? " (softmax)" : ""}, ${r.quantized.scheme} activations`,
        `flash ${r.memory.flashBytes} bytes (const data), RAM ${r.memory.ramBytes} bytes (scratch) + ${r.memory.ioBytes} bytes (your input and output)`,
        `float vs int8 over ${a.samples} ${test !== undefined ? "test" : "calibration"} samples: max abs error ${a.maxAbsError.toPrecision(3)}, ` +
          `mean ${a.meanAbsError.toPrecision(3)}, argmax agreement ${pct(a.argmaxAgreement)} (${a.argmaxMatches}/${a.samples})`,
        ...(a.floatAccuracy !== undefined ? [`label accuracy: float ${pct(a.floatAccuracy)}, int8 ${pct(a.int8Accuracy!)}`] : []),
        `wrote ${show(r.c.headerName)}, ${show(r.c.sourceName)}, ${show(`${name}.report.json`)}`,
      ].join("\n"),
    )
    return 0
  } catch (err) {
    if (err instanceof Quant8Error) {
      io.stderr(`quant8: ${err.message}`)
      return 1
    }
    throw err
  }
}
