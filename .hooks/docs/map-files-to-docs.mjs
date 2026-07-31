// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

const ROOT_DOCS = ['CLAUDE.md', 'README.md']

/**
 * Map changed source file paths to their nearest relevant documentation files.
 * Scoped CLAUDE.md files are discovered on disk: walk up from each changed
 * file and take the nearest ancestor directory that actually contains one.
 * @param {string[]} changedFiles - Relative paths of changed source files
 * @param {string} [cwd] - Project root used to resolve scoped doc existence
 * @returns {string[]} Deduplicated list of doc file paths to review
 */
export function mapFilesToDocs(changedFiles, cwd = process.cwd()) {
  if (changedFiles.length === 0) return []

  const docs = new Set(ROOT_DOCS)

  for (const file of changedFiles) {
    let current = path.dirname(file)
    while (current && current !== '.') {
      const candidate = path.join(current, 'CLAUDE.md')
      if (fs.existsSync(path.join(cwd, candidate))) {
        docs.add(candidate)
        break
      }
      current = path.dirname(current)
    }
  }

  return [...docs].filter((doc) => !changedFiles.includes(doc))
}
