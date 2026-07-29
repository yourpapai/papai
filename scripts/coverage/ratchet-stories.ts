// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'

import { STORY_COVERAGE_LCOV_PATH } from '../story/reports.js'
import { nextFloor, parseLcovTotals, serializeFloor } from './ratchet-lib.js'
import { type CoverageFloor, readCoverageFloor, STORY_COVERAGE_FLOOR_PATH } from './story-coverage-gate.js'

const EPSILON = 0.005

export function computeRatchetedFloor(lcov: string, current: CoverageFloor, epsilon: number): CoverageFloor {
  const totals = parseLcovTotals(lcov)
  return {
    lines: nextFloor(current.lines, totals.lines.pct, epsilon),
    functions: nextFloor(current.functions, totals.functions.pct, epsilon),
  }
}

async function main(): Promise<void> {
  const lcov = await readFile(STORY_COVERAGE_LCOV_PATH, 'utf8')
  const current = await readCoverageFloor(STORY_COVERAGE_FLOOR_PATH)
  const next = computeRatchetedFloor(lcov, current, EPSILON)
  if (next.lines === current.lines && next.functions === current.functions) {
    console.log('T0 coverage floor unchanged.')
    return
  }
  await writeFile(STORY_COVERAGE_FLOOR_PATH, serializeFloor(next))
  console.log(`T0 coverage floor raised to lines ${next.lines}, functions ${next.functions}. Commit the change.`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
