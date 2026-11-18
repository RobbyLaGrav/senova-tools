// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

/**
 * Least squares with a small ridge term (ridge * rows added to the diagonal), solved by Gauss-Jordan elimination with
 * partial pivoting. Returns coefficients B (d x k, one Float64Array per input column) so that X B approximates Y. Add a
 * column of ones to X for an intercept. Builds the d x d normal equations, so it suits up to a few hundred columns.
 */
export function leastSquares(X: readonly ArrayLike<number>[], Y: readonly ArrayLike<number>[], ridge = 1e-6): Float64Array[] {
  const x0 = X[0]
  const y0 = Y[0]
  if (x0 === undefined || y0 === undefined || X.length !== Y.length) {
    throw new RangeError(`X and Y need the same, non-zero number of rows (${X.length} and ${Y.length})`)
  }
  const n = X.length, d = x0.length, k = y0.length
  const A = Array.from({ length: d }, () => new Float64Array(d))
  const C = Array.from({ length: d }, () => new Float64Array(k))
  for (let r = 0; r < n; r++) {
    const x = X[r] as ArrayLike<number>
    const y = Y[r] as ArrayLike<number>
    if (x.length !== d || y.length !== k) throw new RangeError(`row ${r} has the wrong number of values`)
    for (let i = 0; i < d; i++) {
      const xi = x[i] as number
      const Ai = A[i] as Float64Array
      const Ci = C[i] as Float64Array
      for (let j = 0; j < d; j++) Ai[j] = (Ai[j] as number) + xi * (x[j] as number)
      for (let j = 0; j < k; j++) Ci[j] = (Ci[j] as number) + xi * (y[j] as number)
    }
  }
  for (let i = 0; i < d; i++) (A[i] as Float64Array)[i] = ((A[i] as Float64Array)[i] as number) + ridge * n
  for (let c = 0; c < d; c++) {
    let p = c
    for (let r = c + 1; r < d; r++) if (Math.abs((A[r] as Float64Array)[c] as number) > Math.abs((A[p] as Float64Array)[c] as number)) p = r
    const Ac = A[p]!
    const Cc = C[p]!
    A[p] = A[c]!
    C[p] = C[c]!
    A[c] = Ac
    C[c] = Cc
    const piv = Ac[c] as number
    if (piv === 0) throw new RangeError("the system is singular; raise ridge or drop a duplicated column")
    for (let j = 0; j < d; j++) Ac[j] = (Ac[j] as number) / piv
    for (let j = 0; j < k; j++) Cc[j] = (Cc[j] as number) / piv
    for (let r = 0; r < d; r++) {
      if (r === c) continue
      const Ar = A[r] as Float64Array
      const Cr = C[r] as Float64Array
      const f = Ar[c] as number
      if (f === 0) continue
      for (let j = 0; j < d; j++) Ar[j] = (Ar[j] as number) - f * (Ac[j] as number)
      for (let j = 0; j < k; j++) Cr[j] = (Cr[j] as number) - f * (Cc[j] as number)
    }
  }
  return C
}

/** Applies least-squares coefficients B (d x k) to one input row x (d values): returns x B (k values). */
export function applyLinear(B: readonly ArrayLike<number>[], x: ArrayLike<number>): number[] {
  if (B.length !== x.length) throw new RangeError(`x has ${x.length} values, B expects ${B.length}`)
  const k = B[0]?.length ?? 0
  const out = new Array<number>(k).fill(0)
  for (let j = 0; j < k; j++) {
    let s = 0
    for (let i = 0; i < x.length; i++) s += (x[i] as number) * ((B[i] as ArrayLike<number>)[j] as number)
    out[j] = s
  }
  return out
}
