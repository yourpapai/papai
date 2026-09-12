// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { mergeBaselineEntry, parseBaselineEntry } from '../../scripts/mutation/baseline.js'
import type { BaselineMap, BaselineRecord } from '../../scripts/mutation/baseline.js'

export type { BaselineMap, BaselineRecord } from '../../scripts/mutation/baseline.js'

const BASELINE_REL = path.join('scripts', 'mutation', 'baseline.json')

/**
 * Same interpretation as the PR gate by construction: the record shape, guards,
 * and arithmetic validation are imported from `scripts/mutation/baseline.js` —
 * the same relative-import pattern this runner already uses for
 * `json-readers.js`/`score-merger.js`.
 */
export function parseBaseline(json: string): BaselineMap {
  const parsed: unknown = JSON.parse(json)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('baseline.json must be a JSON object of source file -> score entries')
  }
  const out: BaselineMap = {}
  for (const [key, value] of Object.entries(parsed)) {
    out[key] = parseBaselineEntry(key, value)
  }
  return out
}

export function serializeBaseline(map: BaselineMap): string {
  const sorted: BaselineMap = {}
  for (const key of Object.keys(map).sort()) {
    const value = map[key]
    if (value !== undefined) sorted[key] = value
  }
  return `${JSON.stringify(sorted, null, 2)}\n`
}

/**
 * Record-level ratchet bump: the measurement (score plus the killed/timeout/scored
 * counts behind it) merges monotonically per {@link mergeBaselineEntry} — a strictly
 * higher score replaces the record wholesale, an equal-or-lower one over a rich
 * record leaves the previous record (and the map) untouched by reference, and a
 * legacy bare entry measured at exactly its recorded score converts to a rich
 * record at the unchanged floor. The same-map return on a no-op is what keeps
 * `ratchetVerifiedSkip`'s `bumped[file] === baseline[file]` early-return
 * suppressing no-op commits.
 */
export function bumpScore(map: BaselineMap, file: string, measurement: BaselineRecord): BaselineMap {
  // Narrow to exactly the record fields: a caller may pass a richer measurement
  // object (e.g. MeasuredScore with survivingMutantIds) whose extra fields must
  // not leak into the committed baseline.json.
  const record: BaselineRecord = {
    score: measurement.score,
    killed: measurement.killed,
    timeout: measurement.timeout,
    scored: measurement.scored,
  }
  const merged = mergeBaselineEntry(map[file], record)
  if (merged === map[file]) return map
  return { ...map, [file]: merged }
}

export async function readBaseline(repoRoot: string): Promise<BaselineMap> {
  const filePath = path.join(repoRoot, BASELINE_REL)
  try {
    const content = await readFile(filePath, 'utf8')
    return parseBaseline(content)
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return {}
    }
    throw error
  }
}

export async function writeBaseline(repoRoot: string, map: BaselineMap): Promise<void> {
  await writeFile(path.join(repoRoot, BASELINE_REL), serializeBaseline(map))
}
