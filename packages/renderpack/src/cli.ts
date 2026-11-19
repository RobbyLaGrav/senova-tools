// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { relative, resolve } from "node:path"
import { parseArgs } from "node:util"

import { renderpack, type PackOptions } from "./pack.ts"

export const USAGE = `renderpack: CAD renders (PNG) to web images, with a manifest and a contact sheet to check before publishing.

Usage:
  renderpack <in> <out> [options]     <in> is a PNG file or a folder of them; <out> is the output folder

Options:
  -w, --widths <list>          output widths in px (default 480,960,1440,1920; never enlarged)
  -a, --aspect <ratio>         aspect ratio of every output, e.g. 4:3 (default), 1:1, 16:9, or "none"
  -b, --background <colour>    background for flattening and padding (default #ffffff)
      --margin <share>         space around a trimmed object, 0 to 0.45 (default 0.06)
      --tolerance <n>          0 to 255: how close to the background still counts as background (default 8)
      --filter <name>          bicubic (default) or area
      --no-trim                keep the full frame instead of trimming uniform margins
      --no-flatten             keep transparency (padding is transparent)
      --hash-names             put a content hash in output file names
      --duplicate-distance <n> dHash bits (of 64) for the near-duplicate warning (default 6)
      --min-fill <share>       warn when the object covers less of the frame than this (default 0.25)
      --max-pixels <n>         refuse larger inputs (default 50000000)
      --sheet <mode>           contact sheet images: paths (default), inline, or none
      --force                  rebuild everything, ignoring the cache
      --strict                 exit with 1 when there are warnings
  -q, --quiet                  only the summary line
  -h, --help                   this help

Exit codes: 0 done, 1 some inputs failed (or warnings with --strict), 2 bad arguments.`

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

/** Runs the CLI with the given arguments (without `node` and the script) and returns the exit code. */
export async function main(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      allowNegative: true,
      options: {
        widths: { type: "string", short: "w" },
        aspect: { type: "string", short: "a" },
        background: { type: "string", short: "b" },
        margin: { type: "string" },
        tolerance: { type: "string" },
        filter: { type: "string" },
        trim: { type: "boolean" },
        flatten: { type: "boolean" },
        "hash-names": { type: "boolean" },
        "duplicate-distance": { type: "string" },
        "min-fill": { type: "string" },
        "max-pixels": { type: "string" },
        sheet: { type: "string" },
        force: { type: "boolean" },
        strict: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        help: { type: "boolean", short: "h" },
      },
    })
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }
  const { values: v, positionals } = parsed
  if (v.help) {
    io.stdout(USAGE)
    return 0
  }
  let options: PackOptions
  try {
    if (positionals.length !== 2) throw new Error(`expected <in> and <out>, got ${positionals.length} argument(s)`)
    const num = (name: string, s: string | undefined): number | undefined => {
      if (s === undefined) return undefined
      const n = Number(s)
      if (s.trim() === "" || !Number.isFinite(n)) throw new Error(`--${name}: "${s}" is not a number`)
      return n
    }
    const sheet = v.sheet ?? "paths"
    if (sheet !== "paths" && sheet !== "inline" && sheet !== "none") throw new Error(`--sheet: "${sheet}" is not paths, inline or none`)
    const filter = v.filter ?? "bicubic"
    if (filter !== "bicubic" && filter !== "area") throw new Error(`--filter: "${filter}" is not bicubic or area`)
    const opt: Record<string, unknown> = {
      widths: v.widths?.split(",").map((s) => num("widths", s)),
      background: v.background,
      margin: num("margin", v.margin),
      tolerance: num("tolerance", v.tolerance),
      filter,
      trim: v.trim,
      flatten: v.flatten,
      hashNames: v["hash-names"],
      duplicateDistance: num("duplicate-distance", v["duplicate-distance"]),
      minFill: num("min-fill", v["min-fill"]),
      maxPixels: num("max-pixels", v["max-pixels"]),
      force: v.force,
      aspect: v.aspect === undefined ? undefined : v.aspect.toLowerCase() === "none" ? null : v.aspect,
      contactSheet: sheet === "none" ? false : sheet,
    }
    options = Object.fromEntries(Object.entries(opt).filter(([, x]) => x !== undefined)) as PackOptions
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }

  const show = (path: string) => {
    const rel = relative(io.cwd, path)
    return rel === "" ? "." : rel.startsWith("..") ? path : rel
  }
  try {
    const r = renderpack(resolve(io.cwd, positionals[0]!), resolve(io.cwd, positionals[1]!), { ...options, ...(v.quiet ? {} : { log: io.stderr }) })
    if (!v.quiet) {
      for (const e of r.manifest.images) for (const w of e.warnings) io.stdout(`${e.source}: warning [${w.code}] ${w.message}`)
      for (const f of r.manifest.failed) io.stdout(`${f.source}: error: ${f.error}`)
    }
    io.stdout(
      `${r.built} built, ${r.skipped} unchanged, ${r.failed} failed, ${r.warnings} warning(s). ` +
        `Manifest ${show(r.manifestFile)}${r.sheetFile ? `, contact sheet ${show(r.sheetFile)}` : ""}`,
    )
    return r.failed > 0 || (v.strict && r.warnings > 0) ? 1 : 0
  } catch (err) {
    const e = err as Error
    io.stderr(`renderpack: ${e.message}`)
    return e instanceof RangeError || e instanceof TypeError ? 2 : 1
  }
}
