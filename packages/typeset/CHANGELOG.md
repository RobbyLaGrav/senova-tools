# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

### Added

- `renderEquation(tex, opts)`: strict KaTeX rendering to HTML plus MathML; throws `TypesetError` on bad TeX, strict-mode warnings, empty input and blocked commands (`\href`, `\url`, `\includegraphics`, `\html*`).
- `validateAll(snippets)` and `formatReport(report)`: check many equations at once and list every failure with its id, position and reason.
- `fitScale(need, room, minScale)`: the shrink-to-fit arithmetic, free of the DOM.
- React components in `@senova/typeset/react`: `<MathBox>` (equation, Symbols, In plain words), `<Tex>` (inline) and `<FitMath>` (the client helper that shrinks long equations instead of scrolling).
- `typeset.css`, themed with documented `--typeset-*` custom properties and container queries.
