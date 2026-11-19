// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Public API. Everything exported here is documented in the README.
export {
  renderpack,
  processImage,
  normalizeOptions,
  markNearDuplicates,
  listInputs,
  sha256,
  DEFAULT_WIDTHS,
  MANIFEST_FILE,
  SHEET_FILE,
  CACHE_FILE,
  PIPELINE_VERSION,
  type PackOptions,
  type NormalizedOptions,
  type PackResult,
  type Manifest,
  type ImageEntry,
  type OutputFile,
  type Warning,
  type WarningCode,
  type ProcessedImage,
} from "./pack.ts"
export { decodePng, encodePng, isPng, PngError, DEFAULT_MAX_PIXELS, type DecodedPng, type DecodeOptions, type EncodeOptions } from "./png.ts"
export { resize, resizeToWidth, srgbToLinear, linearToSrgb, type ResizeFilter, type ResizeOptions } from "./resize.ts"
export { detectBackground, findContent, crop, flatten, pad, parseAspect, type Background, type Box, type Content, type PadOptions } from "./frame.ts"
export { dHash, hammingDistance, detectCheckerboard, checkName, slugify } from "./checks.ts"
export { contactSheetHtml } from "./sheet.ts"
export { createImage, pixel, parseColor, formatColor, isOpaque, type RgbaImage, type Rgba } from "./image.ts"
