// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { normalizeKeywordSlug } from './keyword-vocabulary.js'

export async function collectJsonFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(e.parentPath, e.name))
}

export async function readAllRecords(files: readonly string[]): Promise<readonly ExtractedBehaviorRecord[]> {
  const parsed = await Promise.all(
    files.map(async (filePath) => {
      const raw: unknown = JSON.parse(await Bun.file(filePath).text())
      return Array.isArray(raw) ? (raw as readonly ExtractedBehaviorRecord[]) : []
    }),
  )
  return parsed.flat()
}

export async function collectUniqueKeywords(extractedDir: string): Promise<readonly string[]> {
  let files: readonly string[]
  try {
    files = await collectJsonFiles(extractedDir)
  } catch {
    return []
  }

  const records = await readAllRecords(files)
  const keywordSet = new Set<string>()
  for (const record of records) {
    if (!Array.isArray(record.keywords)) continue
    for (const kw of record.keywords) {
      if (typeof kw !== 'string') continue
      const slug = normalizeKeywordSlug(kw)
      if (slug.length > 0) {
        keywordSet.add(slug)
      }
    }
  }
  return [...keywordSet].toSorted()
}
