// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'

import { type CoverageFloor, type CoverageMetric, parseFloor, parseLcovTotals } from './ratchet-lib.js'

export type { CoverageFloor, CoverageMetric }

export const STORY_COVERAGE_FLOOR_PATH = 'scripts/story/coverage-floor.json'

export const parseCoverageFloor: (json: string) => CoverageFloor = parseFloor

export async function readCoverageFloor(filePath: string): Promise<CoverageFloor> {
  return parseCoverageFloor(await readFile(filePath, 'utf8'))
}

export type StoryCoverageEvaluation = Readonly<{
  lines: CoverageMetric
  functions: CoverageMetric
  floor: CoverageFloor
  pass: boolean
  failures: readonly string[]
}>

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function evaluateStoryCoverage(lcov: string, floor: CoverageFloor): StoryCoverageEvaluation {
  const totals = parseLcovTotals(lcov)
  const failures: string[] = []
  if (totals.lines.pct < floor.lines) failures.push(`lines ${pct(totals.lines.pct)} < floor ${pct(floor.lines)}`)
  if (totals.functions.pct < floor.functions) {
    failures.push(`functions ${pct(totals.functions.pct)} < floor ${pct(floor.functions)}`)
  }
  return { lines: totals.lines, functions: totals.functions, floor, pass: failures.length === 0, failures }
}

export function formatStoryCoverageEvaluation(evaluation: StoryCoverageEvaluation): string {
  const header = `T0 story coverage: lines ${pct(evaluation.lines.pct)} (floor ${pct(evaluation.floor.lines)}), functions ${pct(evaluation.functions.pct)} (floor ${pct(evaluation.floor.functions)})`
  if (evaluation.pass) return `${header} — OK`
  return `${header}\n  BELOW FLOOR: ${evaluation.failures.join('; ')}`
}
