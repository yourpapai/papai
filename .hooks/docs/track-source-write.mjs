// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

/** @type {string[]} */
export const TRACKED_PREFIXES = ['src/', 'client/', 'plugins/', 'scripts/']

/**
 * Check if a file path should be tracked for doc review.
 * Returns true if the relative path starts with a tracked prefix.
 * Handles both absolute and relative paths by normalizing to relative.
 * @param {string | null | undefined} filePath - File path (absolute or relative)
 * @param {string} [cwd] - Project root for normalizing absolute paths
 * @returns {boolean}
 */
export function trackSourceWrite(filePath, cwd) {
  if (!filePath) return false
  let rel = filePath
  if (path.isAbsolute(filePath) && cwd) {
    rel = path.relative(cwd, filePath)
  }
  return TRACKED_PREFIXES.some((prefix) => rel.startsWith(prefix))
}
