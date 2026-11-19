// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The whole pipeline on a folder: outputs, manifest, warnings, contact sheet, cache skip and corrupt inputs.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { CACHE_FILE, MANIFEST_FILE, SHEET_FILE, decodePng, encodePng, processImage, renderpack, type ImageEntry, type Manifest, type PackOptions } from "../src/index.ts"
import { checkerboard, drawRender } from "./fixtures.ts"

const work = mkdtempSync(join(tmpdir(), "renderpack-"))
after(() => rmSync(work, { recursive: true, force: true }))
let n = 0
const fresh = () => {
  const dir = join(work, `case-${n++}`)
  mkdirSync(join(dir, "in"), { recursive: true })
  return { dir, input: join(dir, "in"), out: join(dir, "out") }
}
const save = (dir: string, name: string, bytes: Uint8Array | string) => writeFileSync(join(dir, name), bytes)
const OPTS: PackOptions = { widths: [100, 200, 400] }
const codes = (e: ImageEntry | undefined) => (e?.warnings.map((w) => w.code) ?? []).sort()
const byName = (m: Manifest, source: string) => m.images.find((e) => e.source === source)

/** A small but realistic batch: one clean shot, a near-duplicate, a tiny one, a thin one, a checkerboard, a bad name. */
function writeBatch(input: string): void {
  save(input, "housing-front.png", encodePng(drawRender({ width: 900, height: 700, cx: 380, cy: 400, rx: 260, ry: 200 })))
  save(input, "housing-front-again.png", encodePng(drawRender({ width: 700, height: 540, cx: 300, cy: 310, rx: 202, ry: 155 })))
  save(input, "housing-tiny.png", encodePng(drawRender({ width: 160, height: 120, cx: 80, cy: 60, rx: 50, ry: 50, hole: 0 })))
  save(input, "shaft-side.png", encodePng(drawRender({ width: 900, height: 600, cx: 450, cy: 300, rx: 400, ry: 18, hole: 0 })))
  const fake = checkerboard(600, 450, 10)
  const part = drawRender({ width: 600, height: 450, cx: 300, cy: 225, rx: 120, ry: 170, hole: 0.6, color: { r: 160, g: 60, b: 40, a: 255 } })
  for (let i = 0; i < fake.data.length; i += 4) if (part.data[i] !== 255 || part.data[i + 1] !== 255) fake.data.set(part.data.subarray(i, i + 4), i)
  save(input, "cover-checker.png", encodePng(fake))
  save(input, "Cover Top_v2.png", encodePng(drawRender({ width: 800, height: 600, cx: 400, cy: 300, rx: 180, ry: 250, hole: 0.2, color: { r: 40, g: 150, b: 90, a: 255 } })))
}

test("README flow: a folder of renders becomes srcset images, a manifest and a contact sheet with the right warnings", () => {
  const { input, out } = fresh()
  writeBatch(input)
  save(input, "notes.txt", "ignored")
  const r = renderpack(input, out, OPTS)
  assert.equal(r.built, 6)
  assert.equal(r.skipped, 0)
  assert.equal(r.failed, 0)
  const m = JSON.parse(readFileSync(join(out, MANIFEST_FILE), "utf8")) as Manifest
  assert.deepEqual(m, JSON.parse(JSON.stringify(r.manifest)))
  assert.deepEqual(m.images.map((e) => e.source), ["Cover Top_v2.png", "cover-checker.png", "housing-front-again.png", "housing-front.png", "housing-tiny.png", "shaft-side.png"])

  assert.deepEqual(codes(byName(m, "housing-front.png")), ["near-duplicate"])
  assert.deepEqual(codes(byName(m, "housing-front-again.png")), ["near-duplicate"])
  assert.match(byName(m, "housing-front.png")!.warnings[0]!.message, /looks like housing-front-again\.png/)
  assert.deepEqual(codes(byName(m, "housing-tiny.png")), ["too-small"])
  assert.deepEqual(codes(byName(m, "shaft-side.png")), ["mostly-empty"])
  assert.deepEqual(codes(byName(m, "cover-checker.png")), ["checkerboard", "uneven-background"])
  assert.deepEqual(codes(byName(m, "Cover Top_v2.png")), ["naming"])

  for (const e of m.images) {
    assert.match(e.sourceSha256, /^[0-9a-f]{64}$/)
    assert.match(e.dHash, /^[0-9a-f]{16}$/)
    assert.equal(e.src, e.outputs[e.outputs.length - 1]!.file)
    assert.equal(e.srcset, e.outputs.map((f) => `${f.file} ${f.width}w`).join(", "))
    for (const f of e.outputs) {
      const bytes = readFileSync(join(out, f.file))
      assert.equal(bytes.length, f.bytes)
      const img = decodePng(bytes)
      assert.deepEqual([img.width, img.height], [f.width, f.height])
      assert.ok(Math.abs(f.height - (f.width * 3) / 4) <= 1, `${f.file} is 4:3`)
    }
    // The placeholder is a real, tiny PNG.
    const ph = decodePng(Buffer.from(e.placeholder.replace(/^data:image\/png;base64,/, ""), "base64"))
    assert.equal(ph.width, 16)
    assert.ok(e.placeholder.length < 1200)
  }
  const front = byName(m, "housing-front.png")!
  assert.deepEqual(front.outputs.map((f) => f.file), ["housing-front-100.png", "housing-front-200.png", "housing-front-400.png"])
  assert.deepEqual(byName(m, "housing-tiny.png")!.outputs.map((f) => f.width), [100])
  assert.equal(byName(m, "Cover Top_v2.png")!.name, "cover-top-v2")

  const sheet = readFileSync(join(out, SHEET_FILE), "utf8")
  assert.match(sheet, /Content-Security-Policy" content="default-src 'none'/)
  assert.doesNotMatch(sheet, /https?:\/\//, "no external requests")
  assert.doesNotMatch(sheet, /<script/i)
  for (const e of m.images) assert.ok(sheet.includes(`src="${encodeURI(e.outputs.find((f) => f.width >= 480)?.file ?? e.src)}"`), e.name)
  for (const c of ["checkerboard", "mostly-empty", "too-small", "near-duplicate", "naming"]) assert.ok(sheet.includes(`<b>${c}</b>`), c)
  assert.match(sheet, /6 images &middot; 6 with warnings/)
})

test("trim and pad: the part ends up centred on the chosen background with even margins", () => {
  const { input, out } = fresh()
  save(input, "part.png", encodePng(drawRender({ width: 1000, height: 800, cx: 400, cy: 350, rx: 250, ry: 250, background: { r: 30, g: 30, b: 30, a: 255 } })))
  const r = renderpack(input, out, { widths: [400], aspect: "1:1", background: "#202020", margin: 0.1, tolerance: 12 })
  const e = r.manifest.images[0]!
  assert.deepEqual(codes(e), [])
  const img = decodePng(readFileSync(join(out, e.src)))
  assert.deepEqual([img.width, img.height], [400, 400])
  // Measure the part's box in the output: it should be centred with a 10% margin (40 px) on every side.
  const d = img.data
  let minX = 400, maxX = 0, minY = 400, maxY = 0
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) {
    const i = (y * 400 + x) * 4
    if (Math.abs(d[i]! - 0x20) > 12 || Math.abs(d[i + 2]! - 0x20) > 12) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
  }
  for (const edge of [minX, minY, 399 - maxX, 399 - maxY]) assert.ok(Math.abs(edge - 40) <= 3, `margin ${edge}`)
  assert.deepEqual([...d.subarray(0, 4)], [0x20, 0x20, 0x20, 255])
  // With the trim off, the frame keeps the original composition (padded to 1:1) and the part stays top-left.
  const r2 = renderpack(input, join(out, "untrimmed"), { widths: [400], aspect: "1:1", background: "#1e1e1e", trim: false })
  assert.equal(r2.manifest.images[0]!.width, 1000)
  assert.equal(r2.manifest.images[0]!.height, 1000)
})

test("transparent renders: flattened onto the background by default, kept with flatten: false", () => {
  const { input, out } = fresh()
  save(input, "clear.png", encodePng(drawRender({ width: 500, height: 400, cx: 200, cy: 200, rx: 120, ry: 120, background: { r: 0, g: 0, b: 0, a: 0 } })))
  const flat = renderpack(input, out, { widths: [200], background: "#336699" })
  const f = decodePng(readFileSync(join(out, flat.manifest.images[0]!.src)))
  assert.equal(f.colorType, 2, "no alpha channel left")
  assert.deepEqual([...f.data.subarray(0, 4)], [0x33, 0x66, 0x99, 255])
  assert.deepEqual(codes(flat.manifest.images[0]), [])

  const kept = renderpack(input, join(out, "kept"), { widths: [200], flatten: false })
  const k = decodePng(readFileSync(join(out, "kept", kept.manifest.images[0]!.src)))
  assert.equal(k.data[3], 0, "padding is transparent")
  assert.deepEqual(codes(kept.manifest.images[0]), ["transparency"])
  assert.match(kept.manifest.images[0]!.warnings[0]!.message, /light and dark/)
  assert.throws(() => renderpack(input, out, { background: "#33669980" }), /must be opaque/)
})

test("cache: unchanged inputs are skipped; edits, deleted outputs, option changes and --force rebuild", () => {
  const { input, out } = fresh()
  writeBatch(input)
  renderpack(input, out, OPTS)
  assert.ok(existsSync(join(out, CACHE_FILE)))
  const again = renderpack(input, out, OPTS)
  assert.deepEqual([again.built, again.skipped], [0, 6])
  // Cross-image warnings are still worked out on a fully cached run.
  assert.deepEqual(codes(byName(again.manifest, "housing-front.png")), ["near-duplicate"])
  assert.equal(again.manifest.images.length, 6)

  save(input, "housing-tiny.png", encodePng(drawRender({ width: 170, height: 120, cx: 80, cy: 60, rx: 50, ry: 50, hole: 0 })))
  unlinkSync(join(out, "shaft-side-200.png"))
  writeFileSync(join(out, "housing-front-100.png"), "tampered")
  const partial = renderpack(input, out, OPTS)
  assert.deepEqual([partial.built, partial.skipped], [3, 3])
  assert.ok(existsSync(join(out, "shaft-side-200.png")))
  assert.notEqual(readFileSync(join(out, "housing-front-100.png"), "utf8"), "tampered")

  assert.deepEqual([renderpack(input, out, { ...OPTS, background: "#fafafa" }).built], [6])
  assert.deepEqual([renderpack(input, out, { ...OPTS, background: "#fafafa", force: true }).built], [6])

  writeFileSync(join(out, CACHE_FILE), "{ not json")
  assert.equal(renderpack(input, out, OPTS).built, 6, "a corrupt cache file means rebuild, not crash")
})

test("corrupt and unsupported inputs are listed as failed and the rest still build", () => {
  const { input, out } = fresh()
  save(input, "good.png", encodePng(drawRender({ width: 400, height: 300, cx: 200, cy: 150, rx: 100, ry: 80 })))
  const good = readFileSync(join(input, "good.png"))
  save(input, "truncated.png", good.subarray(0, good.length - 20))
  const flipped = Buffer.from(good)
  flipped[60] = flipped[60]! ^ 0x55
  save(input, "flipped.png", flipped)
  save(input, "empty.png", "")
  save(input, "photo.png", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))
  save(input, "render.jpg", Uint8Array.from([0xff, 0xd8, 0xff]))
  save(input, "good part.png", good)
  save(input, "good-part.png", good) // same output name as "good part.png"
  const r = renderpack(input, out, { widths: [200] })
  assert.equal(r.built, 2)
  const failed = Object.fromEntries(r.manifest.failed.map((f) => [f.source, f.error]))
  assert.deepEqual(Object.keys(failed).sort(), ["empty.png", "flipped.png", "good-part.png", "photo.png", "render.jpg", "truncated.png"])
  assert.match(failed["truncated.png"]!, /truncated/)
  assert.match(failed["flipped.png"]!, /CRC mismatch/)
  assert.match(failed["empty.png"]!, /the file is empty/)
  assert.match(failed["photo.png"]!, /this is a JPEG file: renderpack reads PNG only/)
  assert.match(failed["render.jpg"]!, /\.jpg files are not supported/)
  assert.match(failed["good-part.png"]!, /already used by good part\.png/)
  const sheet = readFileSync(join(out, SHEET_FILE), "utf8")
  assert.match(sheet, /<h2>Failed<\/h2>/)
  assert.match(sheet, /CRC mismatch/)
})

test("inline contact sheet, hashed names, no sheet, single-file input and option errors", () => {
  const { input, out } = fresh()
  save(input, "a&b's part.png", encodePng(drawRender({ width: 600, height: 450, cx: 300, cy: 225, rx: 200, ry: 150 })))
  const r = renderpack(input, out, { widths: [200, 300], contactSheet: "inline", hashNames: true })
  const e = r.manifest.images[0]!
  assert.match(e.outputs[0]!.file, /^a-b-s-part-200\.[0-9a-f]{8}\.png$/)
  assert.equal(e.outputs[0]!.file.split(".")[1], e.outputs[0]!.sha256.slice(0, 8))
  const sheet = readFileSync(r.sheetFile!, "utf8")
  assert.match(sheet, /<img src="data:image\/png;base64,/)
  assert.ok(sheet.includes("a&#38;b&#39;s part.png"), "names are escaped")
  assert.ok(!sheet.includes("a&b's"))

  const one = renderpack(join(input, "a&b's part.png"), join(out, "single"), { widths: [100], contactSheet: false })
  assert.equal(one.sheetFile, null)
  assert.equal(existsSync(join(out, "single", SHEET_FILE)), false)
  assert.equal(one.manifest.images[0]!.source, "a&b's part.png")

  assert.throws(() => renderpack(input, input, {}), /must not be the input folder/)
  assert.throws(() => renderpack(join(input, "missing"), out, {}), /input not found/)
  assert.throws(() => renderpack(input, out, { widths: [] }), RangeError)
  assert.throws(() => renderpack(input, out, { widths: [0] }), RangeError)
  assert.throws(() => renderpack(input, out, { margin: 0.6 }), /margin/)
  assert.throws(() => renderpack(input, out, { aspect: "wide" }), TypeError)
  assert.throws(() => renderpack(input, out, { background: "teal" }), TypeError)
  assert.throws(() => renderpack(input, out, { contactSheet: "pdf" as never }), TypeError)
})

test("processImage works in memory, and blank frames are flagged instead of failing", () => {
  const blank = encodePng(drawRender({ width: 300, height: 200, cx: -500, cy: -500, rx: 1, ry: 1 }))
  const p = processImage(blank, "blank.png", { widths: [100] })
  assert.deepEqual(p.entry.warnings.map((w) => w.code), ["blank"])
  assert.equal(p.files.length, 1)
  assert.throws(() => processImage(new Uint8Array([1, 2, 3]), "x.png"), /not a PNG file/)
})
