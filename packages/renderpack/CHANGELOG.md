# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

- First version: `renderpack <in> <out>` and the `renderpack()` API. PNG decode and encode on `node:zlib` (all standard
  colour types and bit depths, tRNS, Adam7, CRC checks, decompression cap), linear-light resize (Mitchell or area),
  trim, flatten and pad to one aspect ratio, `manifest.json` with srcset, hashes and placeholders, a self-contained
  contact sheet, warnings (too small, mostly empty, blank, near-duplicate, transparency, checkerboard, uneven or
  mismatched background, naming) and a cache that skips unchanged inputs.
