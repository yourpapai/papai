// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Percentiles } from './types.js'

const EMPTY: Percentiles = {
  count: 0,
  min: 0,
  p50: 0,
  p90: 0,
  p99: 0,
  max: 0,
  mean: 0,
}

function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return sorted[0] ?? 0
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const loVal = sorted[lo] ?? 0
  const hiVal = sorted[hi] ?? 0
  if (lo === hi) return loVal
  return loVal + (hiVal - loVal) * (pos - lo)
}

export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { ...EMPTY }

  const sorted = [...values].sort((a, b) => a - b)
  const count = sorted.length
  const min = sorted[0] ?? 0
  const max = sorted[count - 1] ?? 0

  let sum = 0
  for (const v of sorted) sum += v
  const mean = sum / count

  return {
    count,
    min,
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p99: quantile(sorted, 0.99),
    max,
    mean,
  }
}
