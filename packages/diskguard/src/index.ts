// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Diskguard: watch dev-machine disk space and clear build caches across git worktrees, dry run by default.
export { CACHE_NAMES, NODE_MODULES_CACHES, findCaches, measureDir, type CacheFolder, type DirSize, type FindCachesOptions } from "./caches.ts"
export { clean, scan, type CleanAction, type CleanOptions, type CleanResult, type ScanOptions, type ScanResult } from "./clean.ts"
export { removeTree } from "./remove.ts"
export { checkRoot, containingRoot, isInside } from "./safety.ts"
export {
  checkSpace, getFreeSpace, levelOf, watchFreeSpace,
  type SpaceChange, type SpaceInfo, type SpaceLevel, type SpaceReader, type SpaceStatus, type Thresholds, type WatchOptions,
} from "./space.ts"
export {
  DiskguardInputError, formatBytes, formatThreshold, parseDuration, parseSize, parseThreshold, thresholdBytes, type Threshold,
} from "./units.ts"
export { IN_USE_MARKERS, findWorktrees, parseWorktreePorcelain, type FindWorktreesOptions, type Worktree } from "./worktrees.ts"
