// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

export type OverridesMap = Record<string, string[]>

export type ResolveResult = { kind: 'ok'; testFiles: string[] } | { kind: 'skip'; reason: string }

function isOverridesMap(value: unknown): value is OverridesMap {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => Array.isArray(entry) && entry.every((item) => typeof item === 'string'))
  )
}

/** Load the per-file override map; missing file -> empty map. */
export function loadOverrides(filePath: string): OverridesMap {
  if (!fs.existsSync(filePath)) return {}
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!isOverridesMap(parsed)) {
    throw new Error(`Overrides file ${filePath} must be a JSON object mapping source files to test arrays`)
  }
  return parsed
}

export interface ResolveTestFilesInput {
  srcFile: string
  projectRoot: string
  overrides: OverridesMap
  findTestFile: (implAbsPath: string, projectRoot: string) => string | null
}

export function resolveTestFiles(input: ResolveTestFilesInput): ResolveResult {
  const { srcFile, projectRoot, overrides, findTestFile } = input
  const absImpl = path.join(projectRoot, srcFile)
  const companionAbs = findTestFile(absImpl, projectRoot)
  const companionRel = companionAbs === null ? null : path.relative(projectRoot, companionAbs)

  const extras = overrides[srcFile] ?? []
  const ordered = companionRel === null ? [...extras] : [companionRel, ...extras]
  const deduped = Array.from(new Set(ordered))

  if (deduped.length === 0) {
    return {
      kind: 'skip',
      reason: `no companion test for ${srcFile} and no override registered in scripts/mutation/overrides.json`,
    }
  }
  return { kind: 'ok', testFiles: deduped }
}
