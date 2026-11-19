// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The contact sheet: one self-contained HTML page showing every output with its warnings, to check before publishing.
// No scripts and no external requests: a Content-Security-Policy in the page only allows its own inline styles and
// images from data: URIs or files next to it. Every name from the input is HTML-escaped.
import type { ImageEntry, Manifest } from "./pack.ts"

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Builds the contact sheet HTML. `srcFor` returns the image URL for an entry (a relative path or a data: URI). */
export function contactSheetHtml(manifest: Manifest, srcFor: (entry: ImageEntry) => string): string {
  const { images, failed, options } = manifest
  const flagged = images.filter((e) => e.warnings.length > 0)
  const card = (e: ImageEntry, i: number) => `
  <article class="card${e.warnings.length ? " warn" : ""}" id="img-${i}">
    <div class="frame" style="aspect-ratio:${e.width} / ${e.height}"><img src="${esc(srcFor(e))}" alt="${esc(e.name)}" width="${e.width}" height="${e.height}" loading="lazy"></div>
    <h2>${esc(e.name)}</h2>
    <p class="meta">${esc(e.source)} &middot; ${e.sourceWidth} &times; ${e.sourceHeight} &rarr; ${e.width} &times; ${e.height}</p>
    <p class="meta">${e.outputs.map((f) => `${f.width} px (${kb(f.bytes)})`).join(" &middot; ")}</p>
    <p class="meta">placeholder <img class="ph" src="${esc(e.placeholder)}" alt="" width="48"></p>
    <p class="meta mono">dHash ${esc(e.dHash)} &middot; sha256 ${esc(e.sourceSha256.slice(0, 12))}</p>
    ${e.warnings.length ? `<ul class="warnings">${e.warnings.map((w) => `<li><b>${esc(w.code)}</b> ${esc(w.message)}</li>`).join("")}</ul>` : `<p class="ok">No warnings</p>`}
  </article>`
  const summary = [
    `${images.length} image${images.length === 1 ? "" : "s"}`,
    `${flagged.length} with warnings`,
    ...(failed.length ? [`${failed.length} failed`] : []),
  ].join(" &middot; ")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: file:; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>Renderpack contact sheet</title>
<style>
:root { --bg: #f6f6f4; --card: #ffffff; --text: #1d1d1b; --muted: #66665f; --line: #deded8; --warn: #a33a00; --warn-bg: #fff3eb; --ok: #2d6a2d; --check: #e9e9e4; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181a; --card: #222225; --text: #ececea; --muted: #a2a29c; --line: #34343a; --warn: #ffb28a; --warn-bg: #3a2418; --ok: #8fd18f; --check: #2c2c30; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main, section { max-width: 1200px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
.lede { color: var(--muted); margin: 0 0 8px; }
.jump { margin: 0 0 20px; padding-left: 18px; }
.jump a { color: var(--warn); }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
.card.warn { border-color: var(--warn); }
/* A checkerboard behind each image, so any transparency left in an output is visible. */
.frame { width: 100%; border-radius: 4px; overflow: hidden; background: conic-gradient(var(--check) 25%, transparent 0 50%, var(--check) 0 75%, transparent 0) 0 0 / 16px 16px; }
.frame img { display: block; width: 100%; height: 100%; object-fit: contain; }
.ph { vertical-align: middle; border-radius: 2px; }
h2 { font-size: 15px; margin: 10px 0 2px; overflow-wrap: anywhere; }
.meta { color: var(--muted); margin: 2px 0; overflow-wrap: anywhere; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.warnings { margin: 8px 0 0; padding: 8px 8px 8px 24px; background: var(--warn-bg); color: var(--warn); border-radius: 4px; }
.warnings li + li { margin-top: 4px; }
.ok { color: var(--ok); margin: 8px 0 0; }
.failed { margin-top: 24px; }
.failed li { color: var(--warn); overflow-wrap: anywhere; }
</style>
</head>
<body>
<header>
  <h1>Renderpack contact sheet</h1>
  <p class="lede">${summary}. Widths ${options.widths.join(", ")} px, aspect ${options.aspect === null ? "kept" : esc(ratio(options.aspect))}, background ${esc(options.background)}${options.flatten ? "" : " (transparency kept)"}.</p>
  ${flagged.length ? `<ol class="jump">${flagged.map((e) => `<li><a href="#img-${images.indexOf(e)}">${esc(e.name)}</a>: ${e.warnings.map((w) => esc(w.code)).join(", ")}</li>`).join("")}</ol>` : ""}
</header>
<main>${images.map(card).join("")}
</main>
${failed.length ? `<section class="failed"><h2>Failed</h2><ul>${failed.map((f) => `<li><b>${esc(f.source)}</b>: ${esc(f.error)}</li>`).join("")}</ul></section>` : ""}
</body>
</html>
`
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
}

function ratio(a: number): string {
  for (let h = 1; h <= 20; h++) {
    const w = a * h
    if (Math.abs(w - Math.round(w)) < 1e-6) return `${Math.round(w)}:${h}`
  }
  return a.toFixed(3)
}
