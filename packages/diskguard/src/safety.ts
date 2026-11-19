// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The checks that decide whether a folder may be touched at all: what counts as a root, and whether a path's real
// location (after resolving symlinks and junctions in every parent) is inside one.
import { lstatSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, parse, relative, resolve, sep } from "node:path"

import { DiskguardInputError } from "./units.ts"

const caseInsensitive = process.platform === "win32" || process.platform === "darwin"
const norm = (p: string) => (caseInsensitive ? p.toLowerCase() : p)

/** True when `child` is strictly inside `parent` (both absolute, already resolved). Equal paths are not inside. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(norm(parent), norm(child))
  return rel !== "" && !rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel)
}

function samePath(a: string, b: string): boolean {
  return norm(resolve(a)) === norm(resolve(b))
}

/**
 * Checks a root the user passed and returns its real path. Refuses: paths that don't exist or aren't folders,
 * filesystem roots (`/`, `C:\`), the home folder, and any folder that contains the home folder (`/home`, `C:\Users`).
 */
export function checkRoot(input: string, home: string = homedir()): string {
  if (typeof input !== "string" || input.trim() === "") throw new DiskguardInputError("a root must be a non-empty path")
  const abs = resolve(input)
  let real: string
  try {
    real = realpathSync(abs)
    if (!lstatSync(real).isDirectory()) throw new Error("not a folder")
  } catch {
    throw new DiskguardInputError(`root "${input}" is not an existing folder`)
  }
  for (const p of [abs, real]) {
    if (parse(p).root === p || samePath(parse(p).root, p)) throw new DiskguardInputError(`refusing root "${input}": it is the top of a filesystem`)
    if (home !== "") {
      const realHome = safeRealpath(home)
      for (const h of [resolve(home), realHome]) {
        if (samePath(p, h)) throw new DiskguardInputError(`refusing root "${input}": it is the home folder; pass the folder that holds your projects instead`)
        if (isInside(p, h)) throw new DiskguardInputError(`refusing root "${input}": it contains the home folder`)
      }
    }
  }
  return real
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/**
 * The root (from `roots`, real paths) that really contains `path`, or undefined. Resolves symlinks and junctions in
 * every component of `path` first, so a link pointing outside the roots is caught even if it sits in a parent folder.
 */
export function containingRoot(path: string, roots: readonly string[]): string | undefined {
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    return undefined
  }
  return roots.find((r) => isInside(r, real))
}
