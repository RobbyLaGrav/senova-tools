// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"
import { crc32, deflateSync } from "node:zlib"

import { decodePng, encodePng, isPng, PngError, chunk, PNG_SIGNATURE } from "../src/png.ts"
import { createImage } from "../src/image.ts"
import { handPng, ihdr, join, rawChunk, randomImage } from "./fixtures.ts"

const SIG = [...PNG_SIGNATURE]

test("CRC-32: node:zlib matches the PNG spec's check value, and our chunks carry it", () => {
  assert.equal(crc32("123456789"), 0xcbf43926)
  // IEND's CRC is the same in every PNG file.
  assert.deepEqual([...chunk("IEND", new Uint8Array(0))], [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
})

test("round trip: random RGBA, RGB, grey and grey+alpha come back byte for byte", () => {
  const rgba = randomImage(37, 23, 1)
  const back = decodePng(encodePng(rgba))
  assert.equal(back.width, 37)
  assert.equal(back.height, 23)
  assert.deepEqual(back.data, rgba.data)
  assert.equal(back.colorType, 6)

  const rgb = randomImage(16, 9, 2, false)
  const b2 = decodePng(encodePng(rgb))
  assert.equal(b2.colorType, 2)
  assert.deepEqual(b2.data, rgb.data)

  const grey = randomImage(10, 10, 3, false)
  for (let i = 0; i < grey.data.length; i += 4) grey.data[i + 1] = grey.data[i + 2] = grey.data[i]!
  assert.equal(decodePng(encodePng(grey)).colorType, 0)
  assert.deepEqual(decodePng(encodePng(grey)).data, grey.data)

  const greyA = randomImage(10, 10, 4)
  for (let i = 0; i < greyA.data.length; i += 4) greyA.data[i + 1] = greyA.data[i + 2] = greyA.data[i]!
  assert.equal(decodePng(encodePng(greyA)).colorType, 4)
  assert.deepEqual(decodePng(encodePng(greyA)).data, greyA.data)
})

test("encoder: a forced colour type is honoured, 1 x 1 works, and smooth images compress", () => {
  const one = createImage(1, 1, { r: 9, g: 8, b: 7, a: 6 })
  assert.deepEqual(decodePng(encodePng(one)).data, one.data)
  const forced = decodePng(encodePng(createImage(3, 3, { r: 5, g: 5, b: 5, a: 255 }), { colorType: 6 }))
  assert.equal(forced.colorType, 6)
  const grad = createImage(256, 256)
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) grad.data.set([x, y, 128, 255], (y * 256 + x) * 4)
  assert.ok(encodePng(grad).length < 256 * 256 * 3 / 20, "filters should make a gradient compress well")
  assert.throws(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) }), RangeError)
})

const spot = (img: { width: number; data: Uint8Array }, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)]

test("decoder: 8-bit greyscale, RGB, RGBA, grey+alpha with every filter type", () => {
  const w = 7, h = 10 // ten rows: each of the five filters used twice
  const g = decodePng(handPng({ width: w, height: h, colorType: 0, bitDepth: 8, samples: (x, y) => [(x * 30 + y * 7) & 255] }))
  assert.deepEqual(spot(g, 3, 4), [118, 118, 118, 255])
  const rgb = decodePng(handPng({ width: w, height: h, colorType: 2, bitDepth: 8, samples: (x, y) => [x * 20, y * 20, 200] }))
  assert.deepEqual(spot(rgb, 6, 9), [120, 180, 200, 255])
  const rgba = decodePng(handPng({ width: w, height: h, colorType: 6, bitDepth: 8, samples: (x, y) => [x, y, x + y, 100 + x] }))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.deepEqual(spot(rgba, x, y), [x, y, x + y, 100 + x])
  const ga = decodePng(handPng({ width: w, height: h, colorType: 4, bitDepth: 8, samples: (x, y) => [x * 10, y * 10] }))
  assert.deepEqual(spot(ga, 5, 2), [50, 50, 50, 20])
  assert.equal(ga.hasAlpha, true)
  assert.equal(rgb.hasAlpha, false)
})

test("decoder: palette images at 1, 2, 4 and 8 bits, with tRNS alpha", () => {
  const palette = [255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]
  for (const depth of [1, 2, 4, 8]) {
    const n = Math.min(4, 1 << depth)
    const img = decodePng(handPng({
      width: 11, height: 5, colorType: 3, bitDepth: depth, palette: palette.slice(0, n * 3), trns: [255, 128].slice(0, Math.min(2, n)),
      samples: (x, y) => [(x + y) % n],
    }))
    assert.deepEqual(spot(img, 0, 0), [255, 0, 0, 255], `depth ${depth}`)
    assert.deepEqual(spot(img, 1, 0), [0, 255, 0, 128], `depth ${depth}`)
    if (n === 4) assert.deepEqual(spot(img, 3, 0), [10, 20, 30, 255])
    assert.equal(img.hasAlpha, true)
  }
})

test("decoder: low-bit greyscale scales to 0..255, 16-bit rounds to 8, and tRNS colour keys", () => {
  const g1 = decodePng(handPng({ width: 9, height: 1, colorType: 0, bitDepth: 1, samples: (x) => [x % 2] }))
  assert.deepEqual([spot(g1, 0, 0)[0], spot(g1, 1, 0)[0], spot(g1, 8, 0)[0]], [0, 255, 0])
  const g2 = decodePng(handPng({ width: 4, height: 1, colorType: 0, bitDepth: 2, samples: (x) => [x] }))
  assert.deepEqual([0, 1, 2, 3].map((x) => spot(g2, x, 0)[0]), [0, 85, 170, 255])
  const g4 = decodePng(handPng({ width: 3, height: 1, colorType: 0, bitDepth: 4, samples: (x) => [x * 7] }))
  assert.deepEqual([0, 1, 2].map((x) => spot(g4, x, 0)[0]), [0, 119, 238])
  const c16 = decodePng(handPng({ width: 2, height: 2, colorType: 2, bitDepth: 16, samples: (x) => [65535, x * 257 * 100, 128] }))
  assert.deepEqual(spot(c16, 1, 0), [255, 100, 0, 255])
  const a16 = decodePng(handPng({ width: 2, height: 1, colorType: 6, bitDepth: 16, samples: () => [0, 0, 0, 32768] }))
  assert.equal(spot(a16, 0, 0)[3], 128)
  const keyGrey = decodePng(handPng({ width: 2, height: 1, colorType: 0, bitDepth: 8, trns: [0, 7], samples: (x) => [x ? 7 : 8] }))
  assert.deepEqual([spot(keyGrey, 0, 0)[3], spot(keyGrey, 1, 0)[3]], [255, 0])
  const keyRgb = decodePng(handPng({ width: 2, height: 1, colorType: 2, bitDepth: 8, trns: [0, 1, 0, 2, 0, 3], samples: (x) => (x ? [1, 2, 3] : [1, 2, 4]) }))
  assert.deepEqual([spot(keyRgb, 0, 0)[3], spot(keyRgb, 1, 0)[3]], [255, 0])
})

test("decoder: Adam7 interlaced files decode to the same pixels as plain ones, including tiny sizes", () => {
  for (const [w, h] of [[13, 11], [1, 1], [3, 2], [8, 8], [9, 1]] as const) {
    for (const [colorType, bitDepth] of [[6, 8], [0, 1], [2, 16]] as const) {
      const ch = { 0: 1, 2: 3, 6: 4 }[colorType]
      const max = (1 << bitDepth) - 1
      const samples = (x: number, y: number) => Array.from({ length: ch }, (_, c) => (x * 31 + y * 17 + c * 5) % (max + 1))
      const plain = decodePng(handPng({ width: w, height: h, colorType, bitDepth, samples }))
      const inter = decodePng(handPng({ width: w, height: h, colorType, bitDepth, samples, interlace: true }))
      assert.equal(inter.interlaced, true)
      assert.deepEqual(inter.data, plain.data, `${w}x${h} type ${colorType} depth ${bitDepth}`)
    }
  }
})

test("decoder: unknown ancillary chunks are skipped", () => {
  const extra = [rawChunk("tEXt", [...Buffer.from("Comment\0hi")]), rawChunk("gAMA", [0, 0, 177, 143])]
  const img = decodePng(handPng({ width: 2, height: 2, colorType: 2, bitDepth: 8, samples: () => [1, 2, 3], extra }))
  assert.deepEqual(spot(img, 1, 1), [1, 2, 3, 255])
})

test("decoder rejects corrupt and hostile files with a clear message", () => {
  const good = handPng({ width: 4, height: 4, colorType: 2, bitDepth: 8, samples: () => [1, 2, 3] })
  const rejects = (bytes: Uint8Array, msg: RegExp, opts = {}) => assert.throws(() => decodePng(bytes, opts), (e: Error) => e instanceof PngError && msg.test(e.message))
  const idat = (data: Uint8Array) => rawChunk("IDAT", data)

  rejects(new Uint8Array(0), /signature/)
  rejects(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), /signature/)
  assert.equal(isPng(good), true)

  const flipped = good.slice()
  flipped[45] = flipped[45]! ^ 0xff // inside IDAT
  rejects(flipped, /CRC mismatch in the IDAT/)
  rejects(join([SIG, ihdr(4, 4, 8, 2), rawChunk("IDAT", [1, 2, 3], true)]), /CRC mismatch/)
  rejects(good.subarray(0, good.length - 12), /no IEND/)
  rejects(good.subarray(0, 40), /truncated/)
  rejects(join([SIG, rawChunk("IDAT", [0]), ihdr(1, 1, 8, 0)]), /first chunk must be IHDR/)
  rejects(join([SIG, ihdr(0, 4, 8, 2), rawChunk("IEND", [])]), /invalid image size/)
  rejects(join([SIG, ihdr(4, 4, 3, 2), rawChunk("IEND", [])]), /bit depth 3 is not valid/)
  rejects(join([SIG, ihdr(4, 4, 8, 5), rawChunk("IEND", [])]), /invalid colour type 5/)
  rejects(join([SIG, ihdr(4, 4, 8, 2, 2), rawChunk("IEND", [])]), /unknown interlace method/)
  rejects(join([SIG, ihdr(1, 1, 8, 0), rawChunk("ABCD", [1]), idat(deflateSync(Uint8Array.from([0, 0]))), rawChunk("IEND", [])]), /unsupported critical chunk ABCD/)
  rejects(join([SIG, ihdr(1, 1, 8, 0), rawChunk("IEND", [])]), /no image data/)
  rejects(join([SIG, ihdr(1, 1, 8, 3), idat(deflateSync(Uint8Array.from([0, 0]))), rawChunk("IEND", [])]), /without a PLTE/)
  rejects(join([SIG, ihdr(2, 1, 8, 3), rawChunk("PLTE", [1, 2, 3]), idat(deflateSync(Uint8Array.from([0, 0, 1]))), rawChunk("IEND", [])]), /palette entry 1/)
  // A bad filter byte (7) on the first row.
  rejects(join([SIG, ihdr(1, 1, 8, 0), idat(deflateSync(Uint8Array.from([7, 0]))), rawChunk("IEND", [])]), /unknown filter type 7/)
  // Too little data, too much data (a small file that inflates far past what the header allows), and garbage.
  rejects(join([SIG, ihdr(4, 4, 8, 0), idat(deflateSync(Uint8Array.from([0, 1]))), rawChunk("IEND", [])]), /truncated or corrupt/)
  rejects(join([SIG, ihdr(4, 4, 8, 0), idat(deflateSync(new Uint8Array(10_000_000))), rawChunk("IEND", [])]), /larger than the header says/)
  rejects(join([SIG, ihdr(4, 4, 8, 0), idat(Uint8Array.from([1, 2, 3, 4])), rawChunk("IEND", [])]), /does not decompress/)
  // Size limit is checked from the header, before any decompression.
  rejects(join([SIG, ihdr(100_000, 100_000, 8, 6), rawChunk("IEND", [])]), /over the 50.0 MP limit/)
  rejects(good, /over the 0.0 MP limit/, { maxPixels: 15 })
  // A chunk length larger than the spec allows.
  const huge = join([SIG, ihdr(1, 1, 8, 0), [0xff, 0xff, 0xff, 0xff, 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0]])
  rejects(huge, /impossible length/)
})
