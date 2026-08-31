// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MergedScore } from './score-merger.js'

/**
 * A rich baseline record: the mutation score plus the absolute counts behind it,
 * stored decomposed exactly as `MergedScore` names them so the score is exactly
 * recomputable (`(killed + timeout) / scored`) and the ratchet can compare
 * numerators — "kills" means `killed + timeout`, the score formula's numerator.
 */
export interface BaselineRecord {
  readonly score: number
  readonly killed: number
  readonly timeout: number
  readonly scored: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const RECORD_FIELDS = ['score', 'killed', 'timeout', 'scored'] as const

/** Shape guard for a rich record. Arithmetic consistency is validated at load (see {@link parseBaselineEntry}). */
export const isBaselineRecord = (value: unknown): value is BaselineRecord => {
  if (!isRecord(value)) return false
  return RECORD_FIELDS.every((field) => {
    const entry = value[field]
    return typeof entry === 'number' && Number.isFinite(entry)
  })
}

/** The score numerator of a committed record: killed + timeout, exactly as the score formula counts them. */
export const recordNumerator = (record: BaselineRecord): number => record.killed + record.timeout

/** The score numerator of a measurement: killed + timeout, matching {@link recordNumerator} field-for-field. */
export const measurementNumerator = (merged: MergedScore): number => merged.killed + merged.timeout

/**
 * A rich record must be arithmetically self-consistent: the three counts finite
 * non-negative integers with `scored > 0`, `score` finite in [0, 1],
 * `killed + timeout <= scored`, and `score` equal to `(killed + timeout) / scored`
 * within 1e-9 (JSON round-trips doubles exactly for values we write, and
 * small-integer divisions round-trip hand edits correctly). The baseline is an
 * enforcement floor — a corrupt record must fail the run loudly at load, naming
 * the file and the expected relation, rather than silently gate on nonsense.
 */
const SCORE_EPSILON = 1e-9

const isNonNegativeInt = (value: number): boolean => Number.isInteger(value) && value >= 0

const validateRecordArithmetic = (sourceFile: string, record: BaselineRecord): void => {
  const where = `Baseline record for "${sourceFile}"`
  for (const field of ['killed', 'timeout', 'scored'] as const) {
    const count = record[field]
    if (!isNonNegativeInt(count)) {
      throw new Error(`${where}: ${field} must be a finite non-negative integer (got ${String(count)})`)
    }
  }
  if (record.scored <= 0) throw new Error(`${where}: scored must be > 0 (got ${String(record.scored)})`)
  if (!(Number.isFinite(record.score) && record.score >= 0 && record.score <= 1)) {
    throw new Error(`${where}: score must be a finite number in [0, 1] (got ${String(record.score)})`)
  }
  const numerator = recordNumerator(record)
  if (numerator > record.scored) {
    throw new Error(`${where}: killed + timeout (${numerator}) must be <= scored (${record.scored})`)
  }
  const expected = numerator / record.scored
  if (Math.abs(record.score - expected) > SCORE_EPSILON) {
    throw new Error(
      `${where}: score (${record.score}) must equal (killed + timeout) / scored = ${expected} within ${SCORE_EPSILON}`,
    )
  }
}

/**
 * Parse one baseline entry. A bare finite number is a legacy score-only floor;
 * anything else must be a rich record, which then passes the arithmetic
 * validation — a corrupt record fails loud with the file named (D3).
 */
export const parseBaselineEntry = (sourceFile: string, value: unknown): number | BaselineRecord => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!isBaselineRecord(value)) {
    throw new Error(
      `Baseline record for "${sourceFile}" must be a finite number or a {score, killed, timeout, scored} record`,
    )
  }
  validateRecordArithmetic(sourceFile, value)
  return value
}
