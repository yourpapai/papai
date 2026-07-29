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
  /** Coverage-discovered test set for this source (e.g. from `buildCoverageMap`). */
  readonly discovered?: readonly string[]
}

export function resolveTestFiles(input: ResolveTestFilesInput): ResolveResult {
  const { srcFile, projectRoot, overrides, findTestFile, discovered } = input
  const extras = overrides[srcFile] ?? []
  const absImpl = path.join(projectRoot, srcFile)
  const companionAbs = findTestFile(absImpl, projectRoot)
  const companionRel = companionAbs === null ? null : path.relative(projectRoot, companionAbs)

  // Coverage-derived set is the primary source; overrides AND the companion stay ADDITIVE.
  // The companion is always included as a safety net: a companion that imports the impl but
  // reports 0 lines-hit (all lines in un-hit branches) would be absent from `discovered`, so
  // including it guarantees that direct coverage is measured rather than undercounted.
  const discoveredFiles = discovered !== undefined && discovered.length > 0 ? [...discovered] : []
  const ordered =
    companionRel === null ? [...discoveredFiles, ...extras] : [companionRel, ...discoveredFiles, ...extras]
  const deduped = Array.from(new Set(ordered))

  if (deduped.length === 0) {
    return {
      kind: 'skip',
      reason: `no companion test for ${srcFile} and no override registered in scripts/mutation/overrides.json`,
    }
  }
  return { kind: 'ok', testFiles: deduped }
}
