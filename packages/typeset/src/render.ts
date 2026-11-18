// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The core: TeX in, HTML plus MathML out, through KaTeX. Meant to run on the server or at build time, so pages ship
// no maths library to the browser. Strict on purpose: a typo, an unknown command or a strict-mode warning throws a
// TypesetError, which fails the build instead of showing broken maths to readers.
import katex from "katex"

/** Options for {@link renderEquation}. */
export interface RenderOptions {
  /** Display (block) maths when true, inline maths when false. Default `true`. */
  readonly display?: boolean
  /** TeX macros, for example `{ "\\R": "\\mathbb{R}" }`. Copied per call, so `\def` in one equation never leaks into the next. */
  readonly macros?: Readonly<Record<string, string>>
}

/** Thrown when TeX can't be rendered. Carries the TeX and, when KaTeX knows it, the character position of the problem. */
export class TypesetError extends Error {
  override readonly name = "TypesetError"
  /** The TeX that failed. */
  readonly tex: string
  /** Zero-based character offset into `tex` where KaTeX stopped, if known. */
  readonly position: number | undefined
  /** KaTeX's reason on its own, for example "Undefined control sequence: \\fracc". */
  readonly reason: string

  constructor(tex: string, reason: string, position?: number) {
    super(`Typeset could not render ${JSON.stringify(shorten(tex))}: ${reason}`)
    this.tex = tex
    this.reason = reason
    this.position = position
  }
}

/**
 * Renders TeX to an HTML string that contains both KaTeX's visual HTML and MathML for screen readers.
 * Throws {@link TypesetError} on any parse error or strict-mode warning, and on empty input.
 */
export function renderEquation(tex: string, opts: RenderOptions = {}): string {
  if (typeof tex !== "string" || tex.trim() === "") throw new TypesetError(String(tex), "the TeX is empty")
  // Links, images and raw HTML classes (\href, \url, \includegraphics, \htmlClass...) are never trusted. KaTeX would
  // quietly print a blocked command in red; recording it here lets us fail loudly like any other error instead.
  const blocked: string[] = []
  let html: string
  try {
    html = katex.renderToString(tex, {
      displayMode: opts.display ?? true,
      output: "htmlAndMathml",
      throwOnError: true,
      strict: "error",
      trust: (ctx) => (blocked.push(ctx.command), false),
      macros: { ...opts.macros },
    })
  } catch (err) {
    if (err instanceof katex.ParseError) throw new TypesetError(tex, err.rawMessage, err.position)
    throw new TypesetError(tex, err instanceof Error ? err.message : String(err))
  }
  if (blocked.length > 0) throw new TypesetError(tex, `${blocked[0]} is not allowed (links, images and HTML are off)`)
  return html
}

const shorten = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}...` : s)
