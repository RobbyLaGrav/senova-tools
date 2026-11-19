# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

### Added

- A layout snapshot format (JSON) and `validateSnapshot` / `parseSnapshot`, which refuse bad input naming the field.
- `collectLayout`, the in-page collector, also shipped as source text (`COLLECTOR_SOURCE`, `collectorExpression`) and as a bookmarklet.
- Rules: `inner-scrollbar`, `page-overflow-x`, `column-misaligned`, `title-wraps`, `title-widow`, `text-clipped`.
- `check`, config with tolerances, ignore and allowScroll selectors, title selectors and per-rule severities; a small CSS selector matcher.
- Text and Markdown formatters, and the `overflow` command (`check`, `collector`).
