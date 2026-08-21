// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LedgerIssueRecord } from './issue-ledger.js'

export const medianOf = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 0 defers as soon as the estimate no longer fits; 1 needs the budget twice as tight; `null` never defers. */
type DeferralTier = 0 | 1 | null

const deferralTier = (record: LedgerIssueRecord): DeferralTier => {
  const { severity, kind, exposure } = record.issue
  if (severity === 'critical' || severity === 'high') return null
  if (kind === 'defect' && exposure?.kind === 'caller') return null
  if (kind === 'cleanup' || severity === 'low') return 0
  if (severity === 'medium') return 1
  return null
}

/**
 * Whether a batch should be held back rather than started, judged per design D5.
 * A cluster is deferrable only when every member is; `estimatedMs` is the median
 * of this round's completed batch durations, and `null` — no history — means
 * start, because a number nobody has does not justify skipping work.
 */
export function shouldDeferBatch(
  records: readonly LedgerIssueRecord[],
  remainingMs: number,
  estimatedMs: number | null,
): boolean {
  if (estimatedMs === null || remainingMs === Infinity) return false
  const tiers = records.map(deferralTier)
  if (tiers.some((tier) => tier === null)) return false
  return tiers.some((tier) => tier === 0) ? remainingMs < estimatedMs : remainingMs < estimatedMs / 2
}
