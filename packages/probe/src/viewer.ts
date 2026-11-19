// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The viewer page the SSE server serves at "/": one self-contained HTML file, no external requests. It subscribes
// to /events and shows the latest value of every (instrument, quantity) with a sparkline of the last 60 readings.
// Data is only ever written with textContent and SVG attributes, never as HTML.

import { createHash } from "node:crypto"

const STYLE = `
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--accent:#2563eb;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c;--accent:#60a5fa;--bad:#f87171}}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
header{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:12px}
h1{font-size:18px;margin:0}
#status{color:var(--muted)}
#status.bad{color:var(--bad)}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:480px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:500}
td.v{font-variant-numeric:tabular-nums;font-size:18px}
td.age{color:var(--muted);font-variant-numeric:tabular-nums}
svg{display:block}
polyline{fill:none;stroke:var(--accent);stroke-width:1.5}
p.empty{color:var(--muted)}
`

const SCRIPT = `
(function(){
  var rows = new Map(), table = document.getElementById("rows"), status = document.getElementById("status")
  var empty = document.getElementById("empty"), NS = "http://www.w3.org/2000/svg", N = 60
  function cell(tr, cls){ var td = document.createElement("td"); if (cls) td.className = cls; tr.appendChild(td); return td }
  function row(m){
    var key = m.instrument + "\\u0000" + m.quantity, r = rows.get(key)
    if (r) return r
    var tr = document.createElement("tr")
    cell(tr).textContent = m.instrument
    cell(tr).textContent = m.quantity
    r = { value: cell(tr, "v"), unit: cell(tr), age: cell(tr, "age"), points: [], t: 0 }
    var svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", "160"); svg.setAttribute("height", "32")
    r.line = document.createElementNS(NS, "polyline"); svg.appendChild(r.line); cell(tr).appendChild(svg)
    r.unit.textContent = m.unit
    table.appendChild(tr); rows.set(key, r); empty.hidden = true
    return r
  }
  function draw(r){
    var p = r.points, lo = Math.min.apply(null, p), hi = Math.max.apply(null, p), span = hi - lo || 1
    r.line.setAttribute("points", p.map(function(v, i){
      return (p.length < 2 ? 0 : (i * 158 / (p.length - 1)) + 1).toFixed(1) + "," + (30 - (v - lo) / span * 28).toFixed(1)
    }).join(" "))
  }
  var es = new EventSource("events")
  es.addEventListener("open", function(){ status.textContent = "live"; status.className = "" })
  es.addEventListener("error", function(){ status.textContent = "reconnecting"; status.className = "bad" })
  es.addEventListener("measurement", function(e){
    var m; try { m = JSON.parse(e.data) } catch (_) { return }
    if (!m || typeof m.value !== "number") return
    var r = row(m)
    r.value.textContent = Number(m.value.toPrecision(6)).toString()
    r.t = m.t; r.points.push(m.value); if (r.points.length > N) r.points.shift(); draw(r)
  })
  setInterval(function(){
    var now = Date.now()
    rows.forEach(function(r){ r.age.textContent = ((now - r.t) / 1000).toFixed(1) + " s ago" })
  }, 250)
})()
`

const hash = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`

/** Content-Security-Policy for the viewer: only its own inline script and style, and requests back to this server. */
export const VIEWER_CSP =
  `default-src 'none'; script-src ${hash(SCRIPT)}; style-src ${hash(STYLE)}; connect-src 'self'; ` +
  `img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

/** Returns the viewer page. */
export function viewerHtml(title = "Probe"): string {
  const t = escapeHtml(title)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${t}</h1><span id="status">connecting</span></header>
<div class="wrap"><table>
<thead><tr><th>Instrument</th><th>Quantity</th><th>Value</th><th>Unit</th><th>Updated</th><th>Last 60</th></tr></thead>
<tbody id="rows"></tbody>
</table></div>
<p id="empty" class="empty">Waiting for the first measurement.</p>
<script>${SCRIPT}</script>
</body>
</html>
`
}
