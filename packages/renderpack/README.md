# Renderpack

Turns a folder of CAD renders (PNG) into web-ready images at a set of widths, with a manifest for `srcset` and a contact sheet that flags problems before you publish.

**For:** hardware companies and anyone putting product renders on a website. One command takes the renders out of the CAD tool and gives you consistently framed, correctly sized images, plus a page to check them on. **Status:** in progress (0.x: the API may still change before 1.0).

- **Consistent framing.** Trims the uniform background around the part, adds an even margin, and pads every image to one aspect ratio and background colour, so a row of product shots lines up.
- **Web sizes.** Resizes to each target width (480, 960, 1440 and 1920 px by default) with a bicubic (Mitchell) or exact area filter, in linear light with premultiplied alpha, so thin edges and transparent borders stay clean. Never enlarges.
- **Transparency handled.** Flattens transparent renders onto the background you choose, or keeps the alpha channel if you ask.
- **Manifest.** `manifest.json` lists, per image, the output files with sizes and SHA-256 hashes, a ready-made `srcset`, and a tiny base64 placeholder to show while the image loads.
- **Contact sheet.** `contact-sheet.html` shows every output with its warnings. One file, no scripts, no external requests.
- **Warnings.** Too small for the largest width, mostly-empty frame, near-duplicates (perceptual hash), transparency left in, a transparency checkerboard baked into the pixels, an uneven background, a background that differs from the output colour, and file names that break web conventions.
- **Fast reruns.** Inputs whose bytes and options haven't changed are skipped, using a cache file in the output folder.

## Install

```sh
npm install @senova/renderpack
```

Not on npm yet: until it is, clone this repository and run `npm install` at its root. Node.js 24 or newer.

## Two-minute example

[`examples/two-minute.ts`](examples/two-minute.ts) draws five stand-in renders into `examples/renders/` (so this repository ships no real product images) and packs them into `examples/web/`:

```sh
node packages/renderpack/examples/two-minute.ts
```

With your own renders, use the command:

```sh
npx renderpack renders/ web/ --widths 480,960,1920
```

On the example renders it prints (progress lines go to stderr):

```
Bracket Top_FINAL.png: warning [naming] file name has spaces, has capital letters, has underscores (use dashes); outputs are named "bracket-top-final"
Bracket Top_FINAL.png: warning [background-mismatch] the render's background is #eeeeee but the output background is #ffffff: edges and gaps inside the object keep the old colour
bracket-front-copy.png: warning [too-small] the framed image is 1516 px wide, less than the largest target 1920 px; skipped 1920 px
bracket-front-copy.png: warning [near-duplicate] looks like bracket-front.png (0 of 64 hash bits differ)
bracket-front.png: warning [too-small] the framed image is 1819 px wide, less than the largest target 1920 px; skipped 1920 px
bracket-front.png: warning [near-duplicate] looks like bracket-front-copy.png (0 of 64 hash bits differ)
bracket-side.png: warning [mostly-empty] the object's bounding box covers 12% of the frame (under 25%)
bracket-side.png: warning [too-small] the framed image is 760 px wide, less than the largest target 1920 px; skipped 960, 1920 px
bracket-back.png: error: not a PNG file: renderpack reads PNG only
4 built, 0 unchanged, 1 failed, 8 warning(s). Manifest web/manifest.json, contact sheet web/contact-sheet.html
```

Open `web/contact-sheet.html` to look at every output and its warnings. Run the command again and unchanged renders are skipped (`0 built, 4 unchanged`). Exit code: 0 when everything built, 1 when an input failed (or, with `--strict`, when there are warnings), 2 for bad arguments, so it fits in a build script.

Then use the manifest in your site (here the outputs are served from `/img/`):

```ts
import manifest from "./web/manifest.json" with { type: "json" }

const shot = manifest.images.find((i) => i.name === "bracket-front")!
const html = `<img src="/img/${shot.src}" srcset="${shot.srcset.replace(/(^|, )/g, "$1/img/")}"
  sizes="(min-width: 960px) 50vw, 100vw" width="${shot.width}" height="${shot.height}" alt="Bracket, front"
  style="background: url(${shot.placeholder}) center / cover">`
```

Or run it from code:

```ts
import { renderpack } from "@senova/renderpack"

const result = renderpack("renders", "web", { widths: [480, 960, 1920], aspect: "4:3", background: "#ffffff" })
for (const img of result.manifest.images) for (const w of img.warnings) console.log(img.source, w.code, w.message)
```

### Options

| CLI | API | Default | What it does |
| --- | --- | --- | --- |
| `-w, --widths 480,960` | `widths` | 480, 960, 1440, 1920 | Output widths in px. Widths above the framed image's width are skipped, never enlarged (with a `too-small` warning). |
| `-a, --aspect 4:3` | `aspect` | `"4:3"` | Aspect ratio of every output (`1:1`, `16/9`, `1.5`). `none` / `null` keeps each image's own shape. |
| `-b, --background #fff` | `background` | `#ffffff` | Colour for flattening and padding: `#rgb`, `#rrggbb`, `white`, `black`. |
| `--margin 0.06` | `margin` | 0.06 | Space around a trimmed part, as a share of the frame (0 to 0.45). |
| `--tolerance 8` | `tolerance` | 8 | How far (0 to 255 per channel) a pixel may differ from the background and still count as background. Raise it for noisy or dithered backgrounds. |
| `--filter area` | `filter` | `bicubic` | `bicubic` (Mitchell-Netravali: sharp, little ringing) or `area` (exact box average, softest). |
| `--no-trim` | `trim: false` | trim on | Keep the full frame instead of cutting the background margins. |
| `--no-flatten` | `flatten: false` | flatten on | Keep transparency; padding is transparent. |
| `--hash-names` | `hashNames` | off | Add 8 hex digits of the output's SHA-256 to file names (`part-960.3fa2b1c4.png`) for long browser caching. |
| `--duplicate-distance 6` | `duplicateDistance` | 6 | dHash bits (of 64) at or below which two images count as near-duplicates. |
| `--min-fill 0.25` | `minFill` | 0.25 | Warn when the part's bounding box covers less of the frame than this. |
| `--max-pixels N` | `maxPixels` | 50,000,000 | Refuse larger inputs (checked from the header, before decoding). |
| `--sheet inline` | `contactSheet` | `paths` | Contact sheet images as relative links (`paths`), embedded data (`inline`), or no sheet (`none` / `false`). |
| `--force` | `force` | off | Rebuild everything, ignoring the cache. |
| `--strict` | | off | Exit 1 when there are warnings. |
| `-q, --quiet` | `log` | | CLI: only the summary line. API: pass `log` to get progress lines. |

### What happens to each render

1. **Decode** the PNG (any standard colour type and bit depth, interlaced or not). Every chunk's CRC is checked; corrupt files are listed under `failed` and the rest still build.
2. **Check** the file name, and look for a baked-in checkerboard in the corners.
3. **Find the background** from the four corners: transparent, or one colour within `tolerance`. If the corners disagree, nothing is trimmed (`uneven-background`).
4. **Trim** to the smallest box holding everything that isn't background.
5. **Flatten** transparency onto `background` (unless `flatten: false`).
6. **Pad** to `aspect`, centred, with `margin` on every side, in `background`.
7. **Resize** to each width and **encode** as PNG (the smallest lossless colour type: greyscale, RGB or RGBA).
8. Across all images: **near-duplicates** by dHash distance.

### Warnings

| Code | Means |
| --- | --- |
| `too-small` | The framed image is narrower than the largest target width; larger widths were skipped. Re-render at a higher resolution. |
| `mostly-empty` | The part's bounding box covers less than `minFill` of the frame (a thin part in a 4:3 frame, or a far-away camera with `--no-trim`). |
| `blank` | The image is all background. |
| `near-duplicate` | Two images have dHashes within `duplicateDistance` bits: the same shot exported twice, or two views that look alike. |
| `transparency` | Transparent pixels were kept (`flatten: false`): check on both light and dark pages. |
| `checkerboard` | A grey two-tone checkerboard fills the corners: a screenshot of the editor's transparency grid, not a transparent export. |
| `uneven-background` | The corners differ (gradient, floor, environment map), so nothing was trimmed. |
| `background-mismatch` | The render's background colour differs from the output background, so anti-aliased edges and gaps inside the part keep the old colour. Render on the output colour or on transparency. |
| `naming` | The file name has spaces, capitals, underscores or other symbols, or is over 60 characters. Outputs use a cleaned-up name either way. |

## API

Everything below is exported from `@senova/renderpack`.

### Pipeline

- **`renderpack(input, outDir, options?): PackResult`**: runs everything. `input` is a PNG file or a folder (PNG files directly inside it, not sub-folders). Writes the outputs, `manifest.json`, `contact-sheet.html` and `.renderpack-cache.json` to `outDir`. Returns `{ manifest, manifestFile, sheetFile, built, skipped, failed, warnings }`. Bad inputs go in `manifest.failed`; bad options, a missing input, or `outDir` equal to the input folder throw.
- **`processImage(bytes, fileName, options?): ProcessedImage`**: the pipeline for one PNG in memory, without file writes or near-duplicate checks. Returns `{ entry, files: [{ file, bytes }] }`.
- **`normalizeOptions(options?)`**: the options with defaults applied and checked (as recorded in the manifest).
- **`markNearDuplicates(images, maxDistance)`**, **`listInputs(input)`**, **`sha256(bytes)`**.
- Types: `PackOptions`, `NormalizedOptions`, `PackResult`, `Manifest`, `ImageEntry`, `OutputFile`, `Warning`, `WarningCode`, `ProcessedImage`. Constants: `DEFAULT_WIDTHS`, `MANIFEST_FILE`, `SHEET_FILE`, `CACHE_FILE`, `PIPELINE_VERSION`.

A manifest entry (from the example):

```json
{
  "source": "bracket-front.png",
  "name": "bracket-front",
  "sourceSha256": "(64 hex digits)",
  "sourceWidth": 2400,
  "sourceHeight": 1800,
  "width": 1819,
  "height": 1364,
  "src": "bracket-front-960.png",
  "srcset": "bracket-front-480.png 480w, bracket-front-960.png 960w",
  "outputs": [
    { "file": "bracket-front-480.png", "width": 480, "height": 360, "bytes": 16175, "sha256": "(64 hex digits)" },
    { "file": "bracket-front-960.png", "width": 960, "height": 720, "bytes": "...", "sha256": "..." }
  ],
  "placeholder": "data:image/png;base64,(a 16 px wide PNG)",
  "dHash": "(16 hex digits)",
  "warnings": [{ "code": "too-small", "message": "..." }]
}
```

`width` and `height` are the framed image the outputs were made from; each output's own size is in `outputs`.

### Images

- **`decodePng(bytes, { maxPixels? }): DecodedPng`**: PNG to 8-bit RGBA. Greyscale, RGB, palette, grey+alpha and RGBA at 1, 2, 4, 8 and 16 bits, tRNS transparency, Adam7 interlacing. Throws `PngError` with a specific message on anything malformed (bad signature, CRC mismatch, truncation, bad filter type, data larger or smaller than the header says, unknown critical chunk).
- **`encodePng(image, { colorType?, level? }): Uint8Array`**: 8-bit RGBA to PNG, choosing greyscale, grey+alpha, RGB or RGBA automatically, with per-row filter selection.
- **`isPng(bytes)`**, **`PngError`**, **`DEFAULT_MAX_PIXELS`**.
- **`resize(image, width, height, { filter? })`**, **`resizeToWidth(image, width, { filter? })`**, **`srgbToLinear(v)`**, **`linearToSrgb(l)`**.
- **`detectBackground(image, tolerance?)`**, **`findContent(image, background, tolerance?)`**, **`crop(image, box)`**, **`flatten(image, colour)`**, **`pad(image, { aspect?, margin?, background? })`**, **`parseAspect(value)`**.
- **`dHash(image)`**, **`hammingDistance(a, b)`**, **`detectCheckerboard(image)`**, **`checkName(fileName)`**, **`slugify(stem)`**.
- **`contactSheetHtml(manifest, srcFor)`**: the contact sheet as a string; `srcFor(entry)` returns each image's URL.
- **`createImage(w, h, fill?)`**, **`pixel(image, x, y)`**, **`parseColor(text)`**, **`formatColor(colour)`**, **`isOpaque(image)`**. Types: `RgbaImage` (`{ width, height, data }`: 8-bit RGBA, straight alpha), `Rgba`, `Background`, `Box`, `Content`, `PadOptions`, `DecodedPng`, `DecodeOptions`, `EncodeOptions`, `ResizeFilter`, `ResizeOptions`.

## Limits

- **PNG in, PNG out only.** JPEG, WebP and AVIF are neither read nor written; JPEG and other image files are listed as failed with a clear message. JPEG was left out to keep the tool free of dependencies; WebP and AVIF encoders are native code. If you need those formats, convert the PNG outputs in your own pipeline. PNG suits renders with flat backgrounds and sharp edges; for photographic renders the files are larger than JPEG or WebP would be.
- **No colour management.** Colour profiles (`iCCP`, `gAMA`, `cHRM`) are ignored and sRGB is assumed, and outputs carry no profile. Renders exported in a wide-gamut profile will shift.
- **8-bit output.** 16-bit inputs are rounded to 8 bits.
- **Corner-based background detection.** A gradient, floor or environment-map background disables trimming (with a warning). A shadow that reaches the frame edge stops the trim there.
- **Heuristic warnings.** dHash reliably catches re-exports and re-sizes of the same shot, but not "the same part from a slightly different angle", and two different parts with the same silhouette can be flagged. The checkerboard detector only looks at the corners. Treat warnings as prompts to look, not verdicts.
- **One folder, not sub-folders.** Old outputs are never deleted: when you rename or remove a render, remove its old outputs yourself.
- **Speed.** Single-threaded JavaScript: about 1.4 s per 2400 x 1800 render at four widths, measured on one desktop PC. PNG encoding at zlib level 9 takes the largest share.
- **Memory.** Inputs over 50 megapixels are refused by default (`--max-pixels`); expect roughly 20 bytes of memory per input pixel while one is processed.

## Dependencies

None. PNG decoding and encoding are written on `node:zlib` (inflate, deflate and CRC-32).

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
