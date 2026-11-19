// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example. It draws five stand-in "CAD renders" (shaded rings on flat backgrounds, made
// here so the repository ships no real product images) into examples/renders/, then packs them into examples/web/.
//
//   node packages/renderpack/examples/two-minute.ts
//
// (Imports ../src/index.ts so it runs inside this repository; in your project, import "@senova/renderpack".)
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { createImage, encodePng, renderpack, type Rgba, type RgbaImage } from "../src/index.ts"

/**
 * A shaded elliptical part (with an optional hole) on a flat background: enough like a product render to exercise
 * every step. Edges are anti-aliased from the distance to the outline.
 */
function part(width: number, height: number, cx: number, cy: number, rx: number, ry: number, hole: number, bg: Rgba, color: Rgba): RgbaImage {
  const img = createImage(width, height, bg)
  const r = Math.min(rx, ry)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry) // 1 on the outline
      const k = Math.min(1, Math.max(0, (1 - d) * r + 0.5), hole > 0 ? Math.max(0, Math.min(1, (d - hole) * r + 0.5)) : 1)
      if (k === 0) continue
      const shade = 0.8 + 0.2 * ((cx - x) / rx + (cy - y) / ry)
      const mix = (c: number, b: number) => Math.round(Math.min(255, Math.max(0, c * shade)) * k + b * (1 - k))
      img.data.set([mix(color.r, bg.r), mix(color.g, bg.g), mix(color.b, bg.b), 255], (y * width + x) * 4)
    }
  }
  return img
}

const WHITE = { r: 255, g: 255, b: 255, a: 255 }
const STEEL = { r: 90, g: 110, b: 135, a: 255 }

/** Writes the example renders into `dir`. */
export function writeExampleRenders(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const save = (name: string, img: RgbaImage) => writeFileSync(join(dir, name), encodePng(img))
  // A good one: the part sits off-centre with lots of empty margin, which trimming fixes.
  save("bracket-front.png", part(2400, 1800, 900, 1000, 600, 600, 0.4, WHITE, STEEL))
  // The same shot exported again, a little smaller: a near-duplicate.
  save("bracket-front-copy.png", part(2000, 1500, 750, 833, 500, 500, 0.4, WHITE, STEEL))
  // A side view, rendered too small for the 1920 px target, and so thin that it leaves most of a 4:3 frame empty.
  save("bracket-side.png", part(800, 600, 400, 300, 330, 40, 0, WHITE, { r: 150, g: 90, b: 60, a: 255 }))
  // Bad file name, and a grey background that differs from the white output background.
  save("Bracket Top_FINAL.png", part(2400, 1800, 1200, 900, 900, 520, 0.75, { r: 238, g: 238, b: 238, a: 255 }, { r: 60, g: 140, b: 90, a: 255 }))
  // A broken file: renderpack lists it as failed and carries on.
  writeFileSync(join(dir, "bracket-back.png"), "not really a PNG")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = fileURLToPath(new URL(".", import.meta.url))
  writeExampleRenders(join(here, "renders"))
  const result = renderpack(join(here, "renders"), join(here, "web"), {
    widths: [480, 960, 1920],
    aspect: "4:3",
    background: "#ffffff",
    log: console.log,
  })
  for (const img of result.manifest.images) for (const w of img.warnings) console.log(`${img.source}: [${w.code}] ${w.message}`)
  for (const f of result.manifest.failed) console.log(`${f.source}: failed: ${f.error}`)
  console.log(`${result.built} built, ${result.skipped} unchanged, ${result.failed} failed. Open ${result.sheetFile}`)
}
