// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
export type CoverageMetric = { found: number; hit: number; pct: number }

function metric(found: number, hit: number): CoverageMetric {
  return { found, hit, pct: found === 0 ? 0 : hit / found }
}

export function parseLcovTotals(lcov: string): {
  lines: CoverageMetric
  functions: CoverageMetric
} {
  let lf = 0
  let lh = 0
  let fnf = 0
  let fnh = 0
  for (const raw of lcov.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('LF:')) lf += Number(line.slice(3))
    else if (line.startsWith('LH:')) lh += Number(line.slice(3))
    else if (line.startsWith('FNF:')) fnf += Number(line.slice(4))
    else if (line.startsWith('FNH:')) fnh += Number(line.slice(4))
  }
  return { lines: metric(lf, lh), functions: metric(fnf, fnh) }
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
