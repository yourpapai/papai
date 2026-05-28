// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** @type {string[]} */
export const TRACKED_PREFIXES = ['src/', 'client/', 'plugins/', 'scripts/']

/**
 * Check if a file path should be tracked for doc review.
 * Returns true if the path starts with a tracked prefix.
 * @param {string | null | undefined} filePath - Relative file path
 * @returns {boolean}
 */
export function trackSourceWrite(filePath) {
  if (!filePath) return false
  return TRACKED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
}
