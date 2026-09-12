// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'

import { isBaselineRecord, measurementNumerator, parseBaselineEntry, recordNumerator } from './baseline-record.js'
import type { BaselineRecord } from './baseline-record.js'
import type { MergedScore } from './score-merger.js'

// The record contract lives in baseline-record.ts (max-lines split) and is
// re-exported here: baseline.ts stays the single import point both consumers
// (PR gate, improvement runner) read the record type and guards from.
export { isBaselineRecord, measurementNumerator, parseBaselineEntry, recordNumerator } from './baseline-record.js'
export type { BaselineRecord } from './baseline-record.js'

/**
 * A committed map of source file -> mutation score, used as a monotonic
 * ratchet baseline. Scores only ever go up: a master run merges new per-file
 * scores via {@link ratchetMerge} / {@link seedMerge} (per-key max), and a PR
 * fails only when a changed file that already has a baseline entry drops below
 * it (see {@link resolveRatchet}). Files with no baseline entry (first-touch)
 * are not regressions — they warn and are seeded after merge.
 *
 * Entries are dual-shape during the lazy migration: a rich {@link BaselineRecord}
 * or a bare legacy number (a score-only floor, judged by score alone). Writers
 * emit rich records; bare entries survive only untouched from the committed file.
 */
export type BaselineMap = Record<string, number | BaselineRecord>

export interface PerFileScore {
  readonly sourceFile: string
  readonly merged: MergedScore
}

export interface RatchetRegression {
  readonly sourceFile: string
  readonly score: number
  readonly threshold: number
  /** Measured kills (killed + timeout). */
  readonly measuredNumerator: number
  /** Recorded kills, or null for a legacy score-only record that never measured a population. */
  readonly recordedNumerator: number | null
}

/** New-code dilution: kills held while the mutant population grew, dropping the ratio. Warns; never fails. */
export interface RatchetDilution {
  readonly sourceFile: string
  readonly score: number
  readonly threshold: number
  readonly measuredNumerator: number
  readonly recordedNumerator: number
}

export interface RatchetResult {
  readonly exitCode: number
  readonly regressions: readonly RatchetRegression[]
  readonly dilutions: readonly RatchetDilution[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const isBaselineMap = (value: unknown): value is BaselineMap =>
  isRecord(value) && Object.values(value).every((v) => typeof v === 'number' || isBaselineRecord(v))

const isLocaleDataFile = (relPath: string): boolean => relPath.startsWith('src/i18n/locales/')

/**
 * Build a baseline map from per-file run results. Files with no scoreable
 * mutants (`scored === 0`) are excluded: a 0 score from "no mutants" is not a
 * real coverage signal — `resolveRatchet` skips them anyway, and recording a
 * placeholder would lock such files to a meaningless threshold.
 * Locale data files (`src/i18n/locales/`) are also excluded — they are plain
 * string catalogs with no branching logic worth mutating.
 */
export const buildBaselineFromPerFile = (perFile: readonly PerFileScore[]): BaselineMap => {
  const out: BaselineMap = {}
  for (const entry of perFile) {
    if (entry.merged.scored === 0) continue
    if (isLocaleDataFile(entry.sourceFile)) continue
    // Rich record: score plus the counts that produced it, so the ratchet can
    // compare numerators and a corrupted record is detectable. Field names are
    // MergedScore's own — zero translation at write/read time.
    out[entry.sourceFile] = {
      score: entry.merged.score,
      killed: entry.merged.killed,
      timeout: entry.merged.timeout,
      scored: entry.merged.scored,
    }
  }
  return out
}

/**
 * Merge one latest entry into an existing one, monotonic per key. A strictly
 * higher score replaces the record wholesale — the new score together with that
 * measurement's counts, never a mix of old and new. An equal-or-lower
 * measurement over an already-rich record leaves it untouched (same record
 * object — no flake churn, no score/counts mixing). The single carve-out serves
 * the lazy migration: a legacy bare entry measured at exactly its recorded score
 * converts to a rich record carrying that measurement's counts at the unchanged
 * floor — a shape upgrade, not a floor change. A below-floor measurement leaves
 * the bare entry: the floor must not drop, and counts cannot be paired with a
 * score they did not produce. Shared with the improvement runner's record-level
 * `bumpScore` so both baseline writers merge identically by construction.
 */
export const mergeBaselineEntry = (
  prev: number | BaselineRecord | undefined,
  next: number | BaselineRecord,
): number | BaselineRecord => {
  if (prev === undefined) return next
  const nextScore = typeof next === 'number' ? next : next.score
  if (typeof prev === 'number') {
    if (nextScore > prev) return next
    if (nextScore === prev && typeof next !== 'number') {
      return { score: prev, killed: next.killed, timeout: next.timeout, scored: next.scored }
    }
    return prev
  }
  return nextScore > prev.score ? next : prev
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
    out[key] = mergeBaselineEntry(existing[key], next)
  }
  return out
}

/**
 * Merge a changed-files run into the baseline, PRESERVING existing keys (unlike
 * {@link ratchetMerge}, which drops keys absent from `latest` — correct for a
 * full run, wrong for a changed-files seed where most baseline files aren't
 * re-measured). Each key merges monotonically per {@link mergeBaselineEntry}; new keys
 * are added.
 */
export const seedMerge = (existing: BaselineMap, latest: BaselineMap): BaselineMap => {
  const out: BaselineMap = { ...existing }
  for (const [key, next] of Object.entries(latest)) {
    out[key] = mergeBaselineEntry(out[key], next)
  }
  return out
}

/**
 * Compare per-file run results against the baseline, classifying each baselined
 * file by the verdict order (D4): score at or above the recorded score passes
 * silently; below it, the numerators decide — fewer kills than the record is a
 * true regression (fail), kills held or better is new-code dilution (warn).
 * A legacy score-only record is judged by score alone and never classified as
 * dilution — it cannot distinguish the two, so it keeps the stricter judgment.
 * Files with no entry (first-touch) and files with no scoreable mutants are
 * skipped. Exit code is 1 only when a true regression exists.
 */
export const resolveRatchet = (perFile: readonly PerFileScore[], baseline: BaselineMap): RatchetResult => {
  const regressions: RatchetRegression[] = []
  const dilutions: RatchetDilution[] = []
  for (const entry of perFile) {
    if (entry.merged.scored === 0) continue
    const recorded = baseline[entry.sourceFile]
    if (recorded === undefined) continue
    const measuredNum = measurementNumerator(entry.merged)
    if (typeof recorded === 'number') {
      if (entry.merged.score < recorded) {
        regressions.push({
          sourceFile: entry.sourceFile,
          score: entry.merged.score,
          threshold: recorded,
          measuredNumerator: measuredNum,
          recordedNumerator: null,
        })
      }
      continue
    }
    const recordedNum = recordNumerator(recorded)
    if (entry.merged.score >= recorded.score) continue
    if (measuredNum < recordedNum) {
      regressions.push({
        sourceFile: entry.sourceFile,
        score: entry.merged.score,
        threshold: recorded.score,
        measuredNumerator: measuredNum,
        recordedNumerator: recordedNum,
      })
    } else {
      dilutions.push({
        sourceFile: entry.sourceFile,
        score: entry.merged.score,
        threshold: recorded.score,
        measuredNumerator: measuredNum,
        recordedNumerator: recordedNum,
      })
    }
  }
  return { exitCode: regressions.length > 0 ? 1 : 0, regressions, dilutions }
}

/** Load a baseline map; returns null when the file is absent (ratchet inactive). */
export const loadBaseline = (filePath: string): BaselineMap | null => {
  if (!fs.existsSync(filePath)) return null
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error(`Baseline file ${filePath} must be a JSON object of source file -> score entries`)
  }
  const out: BaselineMap = {}
  for (const [sourceFile, value] of Object.entries(parsed)) {
    out[sourceFile] = parseBaselineEntry(sourceFile, value)
  }
  return out
}

/**
 * Write a baseline map, sorted by key for deterministic diffs. The top-level
 * file stays a bare map. Entries produced from a measurement are always rich
 * records ({@link buildBaselineFromPerFile}, {@link seedMerge}, {@link ratchetMerge});
 * a bare legacy number survives only when it was loaded from the committed file
 * and never re-measured (lazy migration — the committed baseline.json is not
 * rewritten wholesale, legacy entries convert when their file is next measured).
 */
export const writeBaseline = (filePath: string, baseline: BaselineMap): void => {
  const sorted: BaselineMap = Object.fromEntries(
    Object.entries(baseline).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  fs.writeFileSync(filePath, `${JSON.stringify(sorted, null, 2)}\n`)
}
