// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A displayed equation that always fits its card: never a scrollbar. The equation arrives already rendered (from the
// server or the build) at its natural size. Once laid out in the browser it is measured and, only if it is wider than
// the card, scaled down with font-size so it stays crisp and selectable. It re-fits when the card's width changes and
// once web fonts have loaded. This is the only part of Typeset that runs in the browser.
"use client"

import { createElement, useLayoutEffect, useRef, type ReactElement } from "react"

import { DEFAULT_MIN_SCALE, fitScale } from "./fit.ts"

/** Props for {@link FitMath}. */
export interface FitMathProps {
  /** HTML from `renderEquation`. Inserted as-is, so pass only Typeset's (or KaTeX's) output, never user HTML. */
  readonly html: string
  /** Smallest scale to shrink to, as a fraction of the natural size. Default 0.55. */
  readonly minScale?: number
  /** Extra class for the outer box. */
  readonly className?: string
}

/** Wraps rendered display maths in a box that shrinks the equation to fit its width instead of scrolling. */
export function FitMath({ html, minScale = DEFAULT_MIN_SCALE, className }: FitMathProps): ReactElement {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const b = box.current
    const el = inner.current
    if (!b || !el) return
    let live = true
    const fit = () => {
      if (!live) return
      el.style.fontSize = ""
      const need = (el.querySelector<HTMLElement>(".katex-html") ?? el).scrollWidth
      const cs = getComputedStyle(b)
      const room = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const scale = fitScale(need, room, minScale)
      if (scale !== null) el.style.fontSize = `${scale}em`
    }
    fit()
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit)
    ro?.observe(b)
    void document.fonts?.ready.then(fit)
    return () => {
      live = false
      ro?.disconnect()
    }
  }, [html, minScale])

  return createElement(
    "div",
    { className: className ? `typeset-eq ${className}` : "typeset-eq", ref: box },
    createElement("div", { className: "typeset-eq-inner", ref: inner, dangerouslySetInnerHTML: { __html: html } }),
  )
}
