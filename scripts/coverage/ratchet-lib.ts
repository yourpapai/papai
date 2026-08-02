// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export type CoverageMetric = { found: number; hit: number; pct: number }

type RecordMetric = { found: number; hit: number }

function meanMetric(pooledFound: number, pooledHit: number, records: RecordMetric[]): CoverageMetric {
  const eligible = records.filter((record) => record.found > 0)
  const pct =
    eligible.length === 0 ? 0 : eligible.reduce((sum, record) => sum + record.hit / record.found, 0) / eligible.length
  return { found: pooledFound, hit: pooledHit, pct }
}

export function parseLcovTotals(lcov: string): {
  lines: CoverageMetric
  functions: CoverageMetric
} {
  let lf = 0
  let lh = 0
  let fnf = 0
  let fnh = 0
  const lineRecords: RecordMetric[] = []
  const functionRecords: RecordMetric[] = []
  let currentLf = 0
  let currentLh = 0
  let currentFnf = 0
  let currentFnh = 0

  for (const raw of lcov.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('LF:')) {
      currentLf = Number(line.slice(3))
      lf += currentLf
    } else if (line.startsWith('LH:')) {
      currentLh = Number(line.slice(3))
      lh += currentLh
    } else if (line.startsWith('FNF:')) {
      currentFnf = Number(line.slice(4))
      fnf += currentFnf
    } else if (line.startsWith('FNH:')) {
      currentFnh = Number(line.slice(4))
      fnh += currentFnh
    } else if (line === 'end_of_record') {
      lineRecords.push({ found: currentLf, hit: currentLh })
      functionRecords.push({ found: currentFnf, hit: currentFnh })
      currentLf = 0
      currentLh = 0
      currentFnf = 0
      currentFnh = 0
    }
  }

  return {
    lines: meanMetric(lf, lh, lineRecords),
    functions: meanMetric(fnf, fnh, functionRecords),
  }
}

export type CoverageFloor = { lines: number; functions: number }

// The floor is compared against a 0..1 fraction, so the bounds are part of the
// contract: a percentage-shaped 90 would silently make the gate unsatisfiable.
const floorSchema = z.object({
  lines: z.number().min(0).max(1),
  functions: z.number().min(0).max(1),
})

/**
 * The floor lives in its own JSON file rather than bunfig's `coverageThreshold`
 * because that key is a per-file rule in bun: it fails when any single file is
 * below the bar, which cannot express the aggregate floor this repo gates on.
 */
export function parseFloor(json: string): CoverageFloor {
  return floorSchema.parse(JSON.parse(json))
}

export function nextFloor(current: number, measuredPct: number, epsilon: number): number {
  const candidate = Math.floor((measuredPct - epsilon) * 100) / 100
  return candidate > current ? candidate : current
}

export function serializeFloor(next: CoverageFloor): string {
  return `${JSON.stringify({ lines: next.lines, functions: next.functions }, null, 2)}\n`
}
