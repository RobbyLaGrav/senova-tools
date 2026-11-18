// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Typeset's core, with no React: render TeX strictly, and check many snippets at once.
// React components live in "@senova/typeset/react"; the stylesheet in "@senova/typeset/typeset.css".
export { renderEquation, TypesetError, type RenderOptions } from "./render.ts"
export { formatReport, validateAll, type Snippet, type ValidationFailure, type ValidationReport } from "./validate.ts"
export { DEFAULT_MIN_SCALE, fitScale } from "./fit.ts"
