// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

// Directories that have a CLAUDE.md file
const DOCS_DIRS = ['src/tools', 'src/chat', 'src/providers', 'src/commands']

/**
 * Map changed source file paths to their nearest relevant documentation files.
 * @param {string[]} changedFiles - Relative paths of changed source files
 * @returns {string[]} Deduplicated list of doc file paths to review
 */
export function mapFilesToDocs(changedFiles) {
  if (changedFiles.length === 0) return []

  const docs = new Set()
  docs.add('CLAUDE.md')
  docs.add('README.md')

  for (const file of changedFiles) {
    const dir = path.dirname(file)
    let current = dir
    while (current && current !== '.') {
      const candidate = path.join(current, 'CLAUDE.md')
      if (DOCS_DIRS.includes(current)) {
        docs.add(candidate)
        break
      }
      current = path.dirname(current)
    }
  }

  return [...docs]
}
