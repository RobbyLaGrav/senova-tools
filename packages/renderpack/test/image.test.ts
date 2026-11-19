// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Resize, framing (trim, flatten, pad) and the checks behind the warnings.
import assert from "node:assert/strict"
import { test } from "node:test"

import { checkName, dHash, detectCheckerboard, hammingDistance, slugify } from "../src/checks.ts"
import { crop, detectBackground, findContent, flatten, pad, parseAspect } from "../src/frame.ts"
import { createImage, formatColor, parseColor, pixel } from "../src/image.ts"
import { linearToSrgb, resize, resizeToWidth, srgbToLinear } from "../src/resize.ts"
import { checkerboard, drawRender, randomImage } from "./fixtures.ts"

const WHITE = { r: 255, g: 255, b: 255, a: 255 }

test("resize: a flat colour stays exactly that colour at any size, with either filter", () => {
  const img = createImage(97, 61, { r: 200, g: 40, b: 90, a: 255 })
  for (const filter of ["bicubic", "area"] as const) {
    for (const [w, h] of [[10, 7], [48, 30], [1, 1], [200, 120]] as const) {
      const out = resize(img, w, h, { filter })
      assert.equal(out.width, w)
      assert.equal(out.height, h)
      for (let i = 0; i < out.data.length; i += 4) assert.deepEqual([...out.data.subarray(i, i + 4)], [200, 40, 90, 255], `${filter} ${w}x${h}`)
    }
  }
})

test("resize: averaging happens in linear light (black/white fine detail becomes 188, not 128)", () => {
  const img = createImage(64, 64)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = (x + y) % 2 ? 255 : 0
    img.data.set([v, v, v, 255], (y * 64 + x) * 4)
  }
  const area = resize(img, 8, 8, { filter: "area" })
  const bic = resize(img, 8, 8)
  assert.equal(pixel(area, 3, 3).r, 188)
  assert.ok(Math.abs(pixel(bic, 3, 3).r - 188) <= 1)
  assert.equal(linearToSrgb(0.5), 188)
  assert.equal(linearToSrgb(srgbToLinear(77)), 77)
})

test("resize: area filter gives the exact mean of what each output pixel covers", () => {
  const img = createImage(4, 1, WHITE)
  img.data.set([0, 0, 0, 255], 0)
  img.data.set([0, 0, 0, 255], 4)
  const out = resize(img, 2, 1, { filter: "area" })
  assert.equal(pixel(out, 0, 0).r, 0)
  assert.equal(pixel(out, 1, 0).r, 255)
})

test("resize: colour hidden under fully transparent pixels never bleeds into the edges", () => {
  const img = createImage(40, 40)
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) img.data.set(x < 20 ? [255, 0, 0, 255] : [0, 255, 0, 0], (y * 40 + x) * 4)
  for (const filter of ["bicubic", "area"] as const) {
    const out = resize(img, 7, 7, { filter })
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3]! === 0) continue
      assert.equal(out.data[i + 1], 0, `${filter}: green leaked at byte ${i}`)
    }
    const edge = pixel(out, 3, 3)
    assert.ok(edge.a > 0 && edge.a < 255, "the edge pixel is partly transparent")
    assert.equal(edge.r, 255)
  }
})

test("resize: downscaling a render keeps the part where it was; sizes and bad input", () => {
  const src = drawRender({ width: 400, height: 300, cx: 200, cy: 150, rx: 120, ry: 90 })
  const small = resizeToWidth(src, 100)
  assert.equal(small.height, 75)
  assert.deepEqual(pixel(small, 1, 1), { r: 255, g: 255, b: 255, a: 255 }) // background corner stays white
  assert.ok(pixel(small, 50 - 25, 37).r < 200) // on the part's ring
  assert.deepEqual(pixel(small, 50, 37), { r: 255, g: 255, b: 255, a: 255 }) // the hole
  assert.equal(resizeToWidth(createImage(1000, 1), 10).height, 1)
  const up = resize(randomImage(2, 2, 9), 5, 5)
  assert.equal(up.data.length, 100)
  assert.throws(() => resize(src, 0, 10), RangeError)
  assert.throws(() => resize(src, 10.5, 10), RangeError)
  assert.throws(() => resize(src, 10, 10, { filter: "nearest" as never }), TypeError)
})

test("background detection: transparent, flat colour within tolerance, and uneven", () => {
  assert.deepEqual(detectBackground(createImage(5, 5)), { kind: "transparent" })
  const near = createImage(10, 10, { r: 250, g: 250, b: 250, a: 255 })
  near.data.set([245, 252, 250, 255], 0)
  const bg = detectBackground(near)
  assert.equal(bg.kind, "color")
  assert.equal(detectBackground(near, 2).kind, "uneven")
  const grad = createImage(10, 10, WHITE)
  grad.data.set([0, 0, 0, 255], (99) * 4)
  assert.equal(detectBackground(grad).kind, "uneven")
})

test("findContent and crop: the box hugs the part; an empty image has no box", () => {
  const img = drawRender({ width: 300, height: 200, cx: 100, cy: 120, rx: 40, ry: 30 })
  const c = findContent(img, detectBackground(img))
  assert.ok(c.box)
  const { x, y, width, height } = c.box
  assert.ok(Math.abs(x - 60) <= 1 && Math.abs(y - 90) <= 1, `box at ${x},${y}`)
  assert.ok(Math.abs(width - 80) <= 2 && Math.abs(height - 60) <= 2, `box ${width}x${height}`)
  assert.ok(c.filled > 0.02 && c.filled < 0.2)
  const cut = crop(img, c.box)
  assert.equal(cut.width, width)
  assert.deepEqual(findContent(createImage(4, 4, WHITE), detectBackground(createImage(4, 4, WHITE))), { box: null, filled: 0 })
  assert.throws(() => crop(img, { x: 290, y: 0, width: 20, height: 5 }), RangeError)
  // Transparent background: content is whatever has alpha.
  const t = drawRender({ width: 100, height: 100, cx: 30, cy: 30, rx: 10, ry: 10, background: { r: 0, g: 0, b: 0, a: 0 } })
  const tc = findContent(t, detectBackground(t))
  assert.ok(tc.box && tc.box.x >= 19 && tc.box.x + tc.box.width <= 41)
})

test("flatten composites onto the background; pad centres with the aspect ratio and margin", () => {
  const img = createImage(2, 1, { r: 255, g: 0, b: 0, a: 128 })
  const f = flatten(img, WHITE)
  assert.deepEqual(pixel(f, 0, 0), { r: 255, g: 127, b: 127, a: 255 })

  const part = createImage(100, 50, { r: 0, g: 0, b: 0, a: 255 })
  const p = pad(part, { aspect: 1, margin: 0.1, background: WHITE })
  assert.equal(p.width, 125)
  assert.equal(p.height, 125)
  assert.deepEqual(pixel(p, 11, 62), { r: 255, g: 255, b: 255, a: 255 })
  assert.deepEqual(pixel(p, 12, 62), { r: 0, g: 0, b: 0, a: 255 })
  assert.deepEqual(pixel(p, 62, 37), { r: 0, g: 0, b: 0, a: 255 })
  assert.deepEqual(pixel(p, 62, 36), { r: 255, g: 255, b: 255, a: 255 })
  const tall = pad(createImage(30, 90, WHITE), { aspect: 4 / 3 })
  assert.deepEqual([tall.width, tall.height], [120, 90])
  assert.deepEqual([pad(part).width, pad(part).height], [100, 50])
  assert.throws(() => pad(part, { margin: 0.5 }), RangeError)
  assert.throws(() => pad(part, { aspect: 0 }), RangeError)
})

test("parseAspect and parseColor accept the usual forms and reject the rest", () => {
  assert.equal(parseAspect("4:3"), 4 / 3)
  assert.equal(parseAspect("16/9"), 16 / 9)
  assert.equal(parseAspect("1"), 1)
  assert.equal(parseAspect(1.5), 1.5)
  for (const bad of ["", "4:0", "wide", "-1", "4:3:2"]) assert.throws(() => parseAspect(bad), TypeError, bad)
  assert.deepEqual(parseColor("#fff"), WHITE)
  assert.deepEqual(parseColor("#10203040"), { r: 16, g: 32, b: 48, a: 64 })
  assert.deepEqual(parseColor("transparent").a, 0)
  assert.equal(formatColor(parseColor("F4f4F4")), "#f4f4f4")
  for (const bad of ["#ff", "red", "#gggggg", "rgb(1,2,3)"]) assert.throws(() => parseColor(bad), TypeError, bad)
})

test("dHash: a resized or re-shaded copy is close; a different part is far", () => {
  const a = drawRender({ width: 400, height: 300, cx: 200, cy: 150, rx: 120, ry: 90 })
  const a2 = resizeToWidth(a, 173)
  const a3 = drawRender({ width: 400, height: 300, cx: 200, cy: 150, rx: 120, ry: 90, color: { r: 80, g: 118, b: 165, a: 255 } })
  const b = drawRender({ width: 400, height: 300, cx: 120, cy: 100, rx: 60, ry: 80, hole: 0 })
  assert.match(dHash(a), /^[0-9a-f]{16}$/)
  assert.ok(hammingDistance(dHash(a), dHash(a2)) <= 4)
  assert.ok(hammingDistance(dHash(a), dHash(a3)) <= 4)
  assert.ok(hammingDistance(dHash(a), dHash(b)) > 10)
  assert.equal(hammingDistance("ff00", "0f01"), 5)
  assert.throws(() => hammingDistance("ab", "abc"), TypeError)
})

test("checkerboard: baked-in transparency grids are found; flat, striped, noisy and real renders are not", () => {
  for (const tile of [4, 8, 16]) {
    const c = detectCheckerboard(checkerboard(300, 200, tile))
    assert.ok(c, `tile ${tile}`)
    assert.equal(c.tileSize, tile)
  }
  assert.ok(detectCheckerboard(checkerboard(300, 200, 8, 102, 153)), "dark-theme grid")
  // A part drawn over a checkerboard: the corners still show it.
  const fake = checkerboard(400, 300, 10)
  const part = drawRender({ width: 400, height: 300, cx: 200, cy: 150, rx: 100, ry: 80 })
  for (let i = 0; i < fake.data.length; i += 4) if (part.data[i] !== 255) fake.data.set(part.data.subarray(i, i + 4), i)
  assert.ok(detectCheckerboard(fake))

  assert.equal(detectCheckerboard(createImage(300, 200, WHITE)), null)
  assert.equal(detectCheckerboard(part), null)
  assert.equal(detectCheckerboard(randomImage(300, 200, 5, false)), null)
  const stripes = createImage(300, 200)
  for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) { const v = Math.floor(x / 8) % 2 ? 204 : 255; stripes.data.set([v, v, v, 255], (y * 300 + x) * 4) }
  assert.equal(detectCheckerboard(stripes), null)
  assert.equal(detectCheckerboard(checkerboard(20, 20, 4)), null, "too small to judge")
})

test("file naming: rules and the web-safe name", () => {
  assert.deepEqual(checkName("gearbox-housing-front.png"), [])
  assert.deepEqual(checkName("Gearbox Housing_v2.PNG"), ["has spaces", "has capital letters", "has underscores (use dashes)", "has an upper-case extension"])
  assert.deepEqual(checkName("a--b.png"), ["has leading, trailing or doubled dashes"])
  assert.deepEqual(checkName("part(1).png"), ["has characters other than letters, digits and dashes"])
  assert.equal(checkName(`${"a".repeat(61)}.png`).length, 1)
  assert.equal(slugify("Gearbox Housing_v2"), "gearbox-housing-v2")
  assert.equal(slugify("  Café  Ñandú (final) "), "cafe-nandu-final")
  assert.equal(slugify("___"), "image")
  assert.equal(slugify("x".repeat(80)).length, 60)
})
