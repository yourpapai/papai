// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

// Iteration worktrees are nested inside the repo root and have no node_modules of
// their own (gitignored), while bun resolves bare imports upward from them. Mirror
// that resolution for .bin shims so spawning tools (stryker) works from a worktree.
// When no ancestor provides the bin, return the projectRoot-anchored path so the
// spawn fails with the same familiar ENOENT shape as before.
export const resolveNodeModulesBin = (projectRoot: string, binName: string): string => {
  const fallback = path.join(projectRoot, 'node_modules', '.bin', binName)
  let dir = projectRoot
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '.bin', binName)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return fallback
    dir = parent
  }
}
