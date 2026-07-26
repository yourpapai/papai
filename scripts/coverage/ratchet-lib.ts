// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
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

export function parseBunfigThreshold(toml: string): {
  lines: number
  functions: number
} {
  const match = toml.match(/coverageThreshold\s*=\s*\{\s*lines\s*=\s*([0-9.]+)\s*,\s*functions\s*=\s*([0-9.]+)\s*\}/u)
  if (!match) throw new Error('coverageThreshold line not found in bunfig.toml')
  return { lines: Number(match[1]), functions: Number(match[2]) }
}

export function nextFloor(current: number, measuredPct: number, epsilon: number): number {
  const candidate = Math.floor((measuredPct - epsilon) * 100) / 100
  return candidate > current ? candidate : current
}

export function applyThreshold(toml: string, next: { lines: number; functions: number }): string {
  return toml.replace(
    /coverageThreshold\s*=\s*\{[^}]*\}/u,
    `coverageThreshold = { lines = ${next.lines}, functions = ${next.functions} }`,
  )
}
