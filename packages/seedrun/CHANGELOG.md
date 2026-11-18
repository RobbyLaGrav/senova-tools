# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

### Added

- First version, generalised from the scripts behind our neural-network motion studies.
- `defineExperiment`, `runPart`, `computePart`, `mergeParts`, `loadConfig`: experiments as named parts with derived seeds, one partial file per part, and a merge that refuses missing or stale parts.
- `createRng` (mulberry32 with uniform, int, normal, shuffle, pick and fork) and `deriveSeed`.
- Canonical JSON output (`stableStringify`) and SHA-256 digests, so the same seed gives the same bytes; `Math.random()` is blocked inside parts by default.
- The `seedrun` command: `list`, `run` (parts side by side in separate processes), `merge`, `verify`.
- `@senova/seedrun/ml`: a dense network trained with Adam, a column scaler, ridge least squares, and statistics helpers, giving the original research code's numbers bit for bit.
