// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Deletes a folder tree without ever following a link. A symlink or Windows junction met on the way is removed as a
// link (the link itself, never what it points to). Read-only files (common on Windows) are made writable first.
import { chmod, lstat, readdir, rmdir, unlink } from "node:fs/promises"
import { join } from "node:path"

const code = (err: unknown) => (err as NodeJS.ErrnoException).code

async function removeLink(p: string): Promise<void> {
  try {
    await unlink(p)
  } catch (err) {
    // Windows directory symlinks and junctions are removed with rmdir, which deletes the link, not the target.
    if (code(err) === "EPERM" || code(err) === "EISDIR") await rmdir(p)
    else throw err
  }
}

async function removeFile(p: string): Promise<void> {
  try {
    await unlink(p)
  } catch (err) {
    if (code(err) !== "EPERM" && code(err) !== "EACCES") throw err
    await chmod(p, 0o666)
    await unlink(p)
  }
}

/** Removes `path` and everything under it, using lstat at every step. Returns nothing; throws on the first failure. */
export async function removeTree(path: string): Promise<void> {
  let st
  try {
    st = await lstat(path)
  } catch (err) {
    if (code(err) === "ENOENT") return
    throw err
  }
  if (st.isSymbolicLink()) return removeLink(path)
  if (!st.isDirectory()) return removeFile(path)
  for (const name of await readdir(path)) await removeTree(join(path, name))
  await rmdir(path)
}
