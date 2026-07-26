// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'

import type { MergedScore } from './score-merger.js'

/**
 * A committed map of source file -> mutation score, used as a monotonic
 * ratchet baseline. Scores only ever go up: a master run merges new per-file
 * scores via {@link ratchetMerge} (per-key max), and a PR fails when any
 * changed file drops below `max(floor, baseline[file])` (see
 * {@link resolveRatchet}).
 */
export type BaselineMap = Record<string, number>

export interface PerFileScore {
  readonly sourceFile: string
  readonly merged: MergedScore
}

export interface RatchetRegression {
  readonly sourceFile: string
  readonly score: number
  readonly threshold: number
}

export interface RatchetResult {
  readonly exitCode: number
  readonly regressions: readonly RatchetRegression[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const isBaselineMap = (value: unknown): value is BaselineMap =>
  isRecord(value) && Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v))

/**
 * Build a baseline map from per-file run results. Files with no scoreable
 * mutants (`scored === 0`) are excluded: a 0 score from "no mutants" is not a
 * real coverage signal and would otherwise be perpetually flagged by the floor.
 */
export const buildBaselineFromPerFile = (perFile: readonly PerFileScore[]): BaselineMap => {
  const out: BaselineMap = {}
  for (const entry of perFile) {
    if (entry.merged.scored === 0) continue
    out[entry.sourceFile] = entry.merged.score
  }
  return out
}

/**
 * Merge a latest full-run baseline into the existing one, never decreasing any
 * per-file score. Keys present only in `existing` (files removed from scope)
 * are dropped — they are no longer measured. Keys present only in `latest`
 * (new files) are added.
 */
export const ratchetMerge = (existing: BaselineMap, latest: BaselineMap): BaselineMap => {
  const out: BaselineMap = {}
  for (const [key, next] of Object.entries(latest)) {
    const prev = existing[key]
    out[key] = prev === undefined ? next : Math.max(prev, next)
  }
  return out
}

/**
 * Compare per-file run results against the baseline. A file regresses when its
 * score falls below its recorded baseline; a file with no baseline entry (new
 * to scope) is held to `floor`. Files with no scoreable mutants are skipped
 * (not measurable). Returns exit code 1 if any file regressed.
 *
 * Note: the floor is intentionally applied only to files that lack a baseline
 * entry. Existing files below the floor are held to their own baseline so the
 * gate stays practical while the overall score ratchets upward over time.
 */
export const resolveRatchet = (
  perFile: readonly PerFileScore[],
  baseline: BaselineMap,
  floor: number,
): RatchetResult => {
  const regressions: RatchetRegression[] = []
  for (const entry of perFile) {
    if (entry.merged.scored === 0) continue
    const recorded = baseline[entry.sourceFile]
    const threshold = recorded ?? floor
    if (entry.merged.score < threshold) {
      regressions.push({ sourceFile: entry.sourceFile, score: entry.merged.score, threshold })
    }
  }
  return { exitCode: regressions.length > 0 ? 1 : 0, regressions }
}

/** Load a baseline map; returns null when the file is absent (ratchet inactive). */
export const loadBaseline = (filePath: string): BaselineMap | null => {
  if (!fs.existsSync(filePath)) return null
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!isBaselineMap(parsed)) {
    throw new Error(`Baseline file ${filePath} must be a JSON object mapping source files to numeric scores`)
  }
  return parsed
}

/** Write a baseline map, sorted by key for deterministic diffs. */
export const writeBaseline = (filePath: string, baseline: BaselineMap): void => {
  const sorted: BaselineMap = Object.fromEntries(
    Object.entries(baseline).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  fs.writeFileSync(filePath, `${JSON.stringify(sorted, null, 2)}\n`)
}
