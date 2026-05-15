// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Test helper for extracting changelog sections.
 * This was moved from src/announcements.ts since it's only used in tests.
 */

/**
 * Extract the changelog section for a specific version.
 * Returns null if the version is not found.
 */
export function extractChangelogSection(version: string, content: string): string | null {
  const lines = content.split('\n')
  const headerPrefix = `## [${version}]`
  const startIdx = lines.findIndex((line) => line.startsWith(headerPrefix))
  if (startIdx === -1) return null

  const endIdx = lines.findIndex((line, idx) => idx > startIdx && line.startsWith('## ['))
  const sectionLines = endIdx === -1 ? lines.slice(startIdx + 1) : lines.slice(startIdx + 1, endIdx)
  return sectionLines.join('\n').trim()
}
