// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The pipeline: for each PNG render, decode, check, trim, flatten, pad, resize to every width, encode, and record it in
// manifest.json; then write the contact sheet. Inputs whose bytes and options haven't changed since the last run are
// skipped using a cache file in the output folder (their outputs are re-hashed first, so edited outputs are rebuilt).
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join, relative, resolve, sep } from "node:path"

import { checkName, dHash, detectCheckerboard, hammingDistance, slugify } from "./checks.ts"
import { crop, detectBackground, findContent, flatten, pad, parseAspect } from "./frame.ts"
import { formatColor, isOpaque, parseColor, type Rgba, type RgbaImage } from "./image.ts"
import { DEFAULT_MAX_PIXELS, decodePng, encodePng, isPng } from "./png.ts"
import { resizeToWidth, type ResizeFilter } from "./resize.ts"
import { contactSheetHtml } from "./sheet.ts"

/** Bumped when the output for the same input and options would change, so old caches are ignored. */
export const PIPELINE_VERSION = 1
export const MANIFEST_FILE = "manifest.json"
export const SHEET_FILE = "contact-sheet.html"
export const CACHE_FILE = ".renderpack-cache.json"
export const DEFAULT_WIDTHS: readonly number[] = [480, 960, 1440, 1920]

export interface PackOptions {
  /** Output widths in pixels (default 480, 960, 1440, 1920). Never enlarged: widths above the image's are skipped. */
  widths?: readonly number[]
  /** Background for flattening and padding (default "#ffffff"). */
  background?: string
  /** Composite transparency onto the background (default true). With false, transparency is kept and padding is transparent. */
  flatten?: boolean
  /** Cut uniform background margins down to the object (default true). */
  trim?: boolean
  /** How far (0 to 255 per channel) a pixel may differ from the background and still count as background (default 8). */
  tolerance?: number
  /** Aspect ratio of every output, e.g. "4:3" (default), "1:1", 1.5; null keeps each image's own shape. */
  aspect?: string | number | null
  /** Space around a trimmed object, as a share of the frame (default 0.06). Only applied when trimming. */
  margin?: number
  /** Resize filter: "bicubic" (Mitchell, default) or "area" (exact box average). */
  filter?: ResizeFilter
  /** Put the first 8 hex digits of the output's SHA-256 in its file name, for long browser caching (default false). */
  hashNames?: boolean
  /** Two images whose dHash differs by this many bits or fewer (of 64) are flagged as near-duplicates (default 6). */
  duplicateDistance?: number
  /** Warn when the object's bounding box covers less than this share of the frame (default 0.25). */
  minFill?: number
  /** Width of the base64 placeholder image (default 16). */
  placeholderWidth?: number
  /** Refuse inputs larger than this many pixels (default 50 million). */
  maxPixels?: number
  /** Rebuild everything, ignoring the cache (default false). */
  force?: boolean
  /** Contact sheet images: "paths" (relative links to the outputs, default), "inline" (embedded), or false (no sheet). */
  contactSheet?: "paths" | "inline" | false
  /** Progress lines (default: none). */
  log?: (line: string) => void
}

export type WarningCode =
  | "too-small"
  | "mostly-empty"
  | "blank"
  | "near-duplicate"
  | "transparency"
  | "checkerboard"
  | "naming"
  | "uneven-background"
  | "background-mismatch"

export interface Warning {
  code: WarningCode
  message: string
}

export interface OutputFile {
  /** File name inside the output folder. */
  file: string
  width: number
  height: number
  bytes: number
  sha256: string
}

/** One input image in the manifest. */
export interface ImageEntry {
  /** Input path relative to the input folder, with forward slashes. */
  source: string
  /** Web-safe base name used for the outputs. */
  name: string
  sourceSha256: string
  sourceWidth: number
  sourceHeight: number
  /** Size of the framed image (after trim and pad) the outputs were made from. */
  width: number
  height: number
  /** The largest output, for `src`. */
  src: string
  /** `srcset` attribute value: "name-480.png 480w, name-960.png 960w". File names are relative to the output folder. */
  srcset: string
  outputs: OutputFile[]
  /** A tiny PNG as a data: URI, to show blurred while the real image loads. */
  placeholder: string
  /** 64-bit difference hash (16 hex digits) of the framed image. */
  dHash: string
  warnings: Warning[]
}

export interface Manifest {
  tool: "renderpack"
  pipelineVersion: number
  options: NormalizedOptions
  images: ImageEntry[]
  failed: { source: string; error: string }[]
}

export interface PackResult {
  manifest: Manifest
  manifestFile: string
  sheetFile: string | null
  built: number
  skipped: number
  failed: number
  warnings: number
}

/** The options after defaults, as recorded in the manifest and the cache key. */
export interface NormalizedOptions {
  widths: number[]
  background: string
  flatten: boolean
  trim: boolean
  tolerance: number
  aspect: number | null
  margin: number
  filter: ResizeFilter
  hashNames: boolean
  duplicateDistance: number
  minFill: number
  placeholderWidth: number
  maxPixels: number
}

/** Applies defaults and checks every option (normalising twice gives the same result), throwing a TypeError or RangeError that names the bad one. */
export function normalizeOptions(o: PackOptions = {}): NormalizedOptions {
  const widths = [...(o.widths ?? DEFAULT_WIDTHS)]
  if (widths.length === 0) throw new RangeError("widths: give at least one width")
  for (const w of widths) if (!Number.isInteger(w) || w < 1 || w > 16384) throw new RangeError(`widths: ${w} is not a whole number from 1 to 16384`)
  const bg = parseColor(o.background ?? "#ffffff")
  const flat = o.flatten ?? true
  if (flat && bg.a !== 255) throw new RangeError("background: must be opaque when flattening (or pass flatten: false)")
  const num = (name: string, v: number | undefined, def: number, lo: number, hi: number, int = false): number => {
    const x = v ?? def
    if (typeof x !== "number" || !Number.isFinite(x) || x < lo || x > hi || (int && !Number.isInteger(x))) {
      throw new RangeError(`${name}: ${String(x)} is not ${int ? "a whole number" : "a number"} from ${lo} to ${hi}`)
    }
    return x
  }
  const filter = o.filter ?? "bicubic"
  if (filter !== "bicubic" && filter !== "area") throw new TypeError(`filter: "${String(filter)}" is not bicubic or area`)
  return {
    widths: [...new Set(widths)].sort((a, b) => a - b),
    background: formatColor(bg),
    flatten: flat,
    trim: o.trim ?? true,
    tolerance: num("tolerance", o.tolerance, 8, 0, 255, true),
    aspect: o.aspect === null ? null : parseAspect(o.aspect ?? "4:3"),
    margin: num("margin", o.margin, 0.06, 0, 0.45),
    filter,
    hashNames: o.hashNames ?? false,
    duplicateDistance: num("duplicateDistance", o.duplicateDistance, 6, 0, 64, true),
    minFill: num("minFill", o.minFill, 0.25, 0, 1),
    placeholderWidth: num("placeholderWidth", o.placeholderWidth, 16, 4, 64, true),
    maxPixels: num("maxPixels", o.maxPixels, DEFAULT_MAX_PIXELS, 1, 1e9, true),
  }
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** What processing one image produces, before anything is written. */
export interface ProcessedImage {
  entry: Omit<ImageEntry, "source">
  files: { file: string; bytes: Uint8Array }[]
}

/**
 * Processes one PNG in memory: the whole pipeline except near-duplicate checks (those need every image) and file writes.
 * `fileName` is used for the naming check and the output base name. Throws on input that can't be decoded.
 */
export function processImage(bytes: Uint8Array, fileName: string, options: PackOptions = {}): ProcessedImage {
  const o = normalizeOptions(options)
  if (!isPng(bytes)) throw new Error(`${sniff(bytes)}: renderpack reads PNG only`)
  const decoded = decodePng(bytes, { maxPixels: o.maxPixels })
  const img: RgbaImage = decoded
  const warnings: Warning[] = []
  const bgColor = parseColor(o.background)
  const name = slugify(basename(fileName, extname(fileName)))

  const naming = checkName(basename(fileName))
  if (naming.length) warnings.push({ code: "naming", message: `file name ${naming.join(", ")}; outputs are named "${name}"` })

  const checker = detectCheckerboard(img)
  if (checker) {
    warnings.push({
      code: "checkerboard",
      message: `a ${checker.tileSize} px grey checkerboard is baked into ${checker.corners} corners: this looks like a screenshot of transparency, not a transparent export`,
    })
  }

  const bg = detectBackground(img, o.tolerance)
  const content = findContent(img, bg, o.tolerance)
  let framed = img
  let trimmed = false
  if (content.box === null) {
    warnings.push({ code: "blank", message: "the image is all background: there is nothing in it" })
  } else if (o.trim) {
    if (bg.kind === "uneven") {
      warnings.push({ code: "uneven-background", message: "the corners differ, so no uniform background was found and nothing was trimmed" })
    } else {
      framed = crop(img, content.box)
      trimmed = true
    }
  }
  if (o.flatten && bg.kind === "color" && content.box !== null && maxChannelDiff(bg.color, bgColor) > o.tolerance) {
    warnings.push({
      code: "background-mismatch",
      message: `the render's background is ${formatColor(bg.color)} but the output background is ${o.background}: edges and gaps inside the object keep the old colour`,
    })
  }

  if (o.flatten) framed = flatten(framed, bgColor)
  else if (decoded.hasAlpha && !isOpaque(img)) {
    warnings.push({ code: "transparency", message: "transparent pixels are kept (flatten is off): check the image on both light and dark pages" })
  }
  const padColor: Rgba = o.flatten ? bgColor : { ...bgColor, a: 0 }
  const beforePad = { width: framed.width, height: framed.height }
  framed = pad(framed, { ...(o.aspect !== null ? { aspect: o.aspect } : {}), margin: trimmed ? o.margin : 0, background: padColor })

  if (content.box !== null && bg.kind !== "uneven") {
    const objectArea = trimmed ? beforePad.width * beforePad.height : content.box.width * content.box.height
    const share = objectArea / (framed.width * framed.height)
    if (share < o.minFill) {
      warnings.push({ code: "mostly-empty", message: `the object's bounding box covers ${Math.round(share * 100)}% of the frame (under ${Math.round(o.minFill * 100)}%)` })
    }
  }

  const largest = o.widths[o.widths.length - 1]!
  let widths = o.widths.filter((w) => w <= framed.width)
  if (largest > framed.width) {
    const skipped = o.widths.filter((w) => w > framed.width)
    warnings.push({
      code: "too-small",
      message: `the framed image is ${framed.width} px wide, less than the largest target ${largest} px; skipped ${skipped.join(", ")} px${widths.length === 0 ? ` and wrote ${framed.width} px only` : ""}`,
    })
  }
  if (widths.length === 0) widths = [framed.width]

  const files: { file: string; bytes: Uint8Array }[] = []
  const outputs: OutputFile[] = []
  for (const w of widths) {
    const out = resizeToWidth(framed, w, { filter: o.filter })
    const png = encodePng(out)
    const hash = sha256(png)
    const file = o.hashNames ? `${name}-${w}.${hash.slice(0, 8)}.png` : `${name}-${w}.png`
    files.push({ file, bytes: png })
    outputs.push({ file, width: out.width, height: out.height, bytes: png.length, sha256: hash })
  }
  const tiny = encodePng(resizeToWidth(framed, Math.min(o.placeholderWidth, framed.width), { filter: "area" }))

  return {
    entry: {
      name,
      sourceSha256: sha256(bytes),
      sourceWidth: img.width,
      sourceHeight: img.height,
      width: framed.width,
      height: framed.height,
      src: outputs[outputs.length - 1]!.file,
      srcset: outputs.map((f) => `${encodeURI(f.file)} ${f.width}w`).join(", "),
      outputs,
      placeholder: `data:image/png;base64,${Buffer.from(tiny).toString("base64")}`,
      dHash: dHash(framed),
      warnings,
    },
    files,
  }
}

function maxChannelDiff(a: Rgba, b: Rgba): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
}

function sniff(bytes: Uint8Array): string {
  const b = (i: number) => bytes[i]
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "this is a JPEG file"
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45) return "this is a WebP file"
  if ((b(0) === 0x49 && b(1) === 0x49) || (b(0) === 0x4d && b(1) === 0x4d)) return "this looks like a TIFF file"
  if (bytes.length === 0) return "the file is empty"
  return "not a PNG file"
}

/** Marks near-duplicates across a set of entries (by dHash distance). Replaces any earlier near-duplicate warnings. */
export function markNearDuplicates(images: ImageEntry[], maxDistance: number): void {
  for (const img of images) img.warnings = img.warnings.filter((w) => w.code !== "near-duplicate")
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      const a = images[i]!, b = images[j]!
      const d = hammingDistance(a.dHash, b.dHash)
      if (d > maxDistance) continue
      a.warnings.push({ code: "near-duplicate", message: `looks like ${b.source} (${d} of 64 hash bits differ)` })
      b.warnings.push({ code: "near-duplicate", message: `looks like ${a.source} (${d} of 64 hash bits differ)` })
    }
  }
}

const INPUT_EXT = /\.png$/i
const OTHER_IMAGE_EXT = /\.(jpe?g|webp|avif|tiff?|bmp|gif|heic|exr)$/i

/** Lists the inputs: one file, or the image files directly inside a folder (not sub-folders), sorted by name. */
export function listInputs(input: string): { root: string; files: string[]; unsupported: string[] } {
  if (!existsSync(input)) throw new Error(`input not found: ${input}`)
  if (statSync(input).isFile()) return { root: resolve(input, ".."), files: [resolve(input)], unsupported: [] }
  const names = readdirSync(input).filter((n) => statSync(join(input, n)).isFile()).sort()
  return {
    root: resolve(input),
    files: names.filter((n) => INPUT_EXT.test(n)).map((n) => resolve(input, n)),
    unsupported: names.filter((n) => OTHER_IMAGE_EXT.test(n)).map((n) => resolve(input, n)),
  }
}

interface CacheFile {
  pipelineVersion: number
  optionsKey: string
  entries: Record<string, ImageEntry>
}

function readCache(file: string): CacheFile | undefined {
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as CacheFile
    if (c && c.pipelineVersion === PIPELINE_VERSION && typeof c.optionsKey === "string" && c.entries && typeof c.entries === "object") return c
  } catch {
    // Missing or unreadable cache: rebuild everything.
  }
  return undefined
}

function writeAtomic(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

/** Outputs listed for a cached entry are all still there with the same bytes. */
function outputsIntact(outDir: string, entry: ImageEntry): boolean {
  return entry.outputs.every((f) => {
    const p = join(outDir, f.file)
    return existsSync(p) && statSync(p).size === f.bytes && sha256(readFileSync(p)) === f.sha256
  })
}

/**
 * Runs the whole pipeline: `input` is a PNG file or a folder of them; `outDir` gets the resized images,
 * manifest.json, contact-sheet.html and the cache. Bad inputs are listed in `manifest.failed`, not thrown;
 * bad options and an unusable output folder throw.
 */
export function renderpack(input: string, outDir: string, options: PackOptions = {}): PackResult {
  const o = normalizeOptions(options)
  const log = options.log ?? (() => {})
  const sheetMode = options.contactSheet ?? "paths"
  if (sheetMode !== "paths" && sheetMode !== "inline" && sheetMode !== false) throw new TypeError(`contactSheet: "${String(sheetMode)}" is not paths, inline or false`)
  const { root, files, unsupported } = listInputs(input)
  const out = resolve(outDir)
  if (out === root && statSync(input).isDirectory()) throw new Error("the output folder must not be the input folder")
  mkdirSync(out, { recursive: true })

  const optionsKey = sha256(JSON.stringify({ PIPELINE_VERSION, o }))
  const cachePath = join(out, CACHE_FILE)
  const cache = options.force ? undefined : readCache(cachePath)
  const cached = cache?.optionsKey === optionsKey ? cache.entries : {}
  const rel = (p: string) => relative(root, p).split(sep).join("/")

  const images: ImageEntry[] = []
  const failed: Manifest["failed"] = unsupported.map((p) => ({ source: rel(p), error: `${extname(p)} files are not supported: renderpack reads PNG only` }))
  const names = new Map<string, string>()
  const nextCache: Record<string, ImageEntry> = {}
  let built = 0, skipped = 0

  for (const path of files) {
    const source = rel(path)
    try {
      const bytes = readFileSync(path)
      const name = slugify(basename(path, extname(path)))
      const clash = names.get(name)
      if (clash !== undefined) throw new Error(`its output name "${name}" is already used by ${clash}; rename one of them`)
      names.set(name, source)
      const hit = cached[source]
      let entry: ImageEntry
      if (hit && hit.sourceSha256 === sha256(bytes) && outputsIntact(out, hit)) {
        entry = { ...hit, warnings: hit.warnings.filter((w) => w.code !== "near-duplicate") }
        skipped++
        log(`${source}: unchanged, skipped`)
      } else {
        const p = processImage(bytes, basename(path), o)
        for (const f of p.files) writeAtomic(join(out, f.file), f.bytes)
        entry = { source, ...p.entry }
        built++
        log(`${source}: ${entry.outputs.map((f) => f.width).join(", ")} px${entry.warnings.length ? `, ${entry.warnings.length} warning(s)` : ""}`)
      }
      nextCache[source] = { ...entry, warnings: entry.warnings.filter((w) => w.code !== "near-duplicate") }
      images.push(entry)
    } catch (err) {
      failed.push({ source, error: (err as Error).message })
      log(`${source}: FAILED: ${(err as Error).message}`)
    }
  }
  failed.sort((a, b) => a.source.localeCompare(b.source))
  markNearDuplicates(images, o.duplicateDistance)

  const manifest: Manifest = { tool: "renderpack", pipelineVersion: PIPELINE_VERSION, options: o, images, failed }
  const manifestFile = join(out, MANIFEST_FILE)
  writeAtomic(manifestFile, JSON.stringify(manifest, null, 2) + "\n")
  let sheetFile: string | null = null
  if (sheetMode !== false) {
    sheetFile = join(out, SHEET_FILE)
    const srcFor = (e: ImageEntry): string => {
      const f = sheetImage(e)
      return sheetMode === "inline" ? `data:image/png;base64,${readFileSync(join(out, f.file)).toString("base64")}` : encodeURI(f.file)
    }
    writeAtomic(sheetFile, contactSheetHtml(manifest, srcFor))
  }
  writeAtomic(cachePath, JSON.stringify({ pipelineVersion: PIPELINE_VERSION, optionsKey, entries: nextCache } satisfies CacheFile) + "\n")
  return { manifest, manifestFile, sheetFile, built, skipped, failed: failed.length, warnings: images.reduce((n, e) => n + e.warnings.length, 0) }
}

/** The output shown on the contact sheet: the smallest one at least 480 px wide, else the largest. */
function sheetImage(e: ImageEntry): OutputFile {
  return e.outputs.find((f) => f.width >= 480) ?? e.outputs[e.outputs.length - 1]!
}
