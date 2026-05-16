// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewLoopResult } from './loop-controller.js'

export function formatSummary(result: ReviewLoopResult): string {
  const records = Object.values(result.ledger.issues)
  const counts = {
    closed: records.filter((record) => record.status === 'closed').length,
    rejected: records.filter((record) => record.status === 'rejected').length,
    alreadyFixed: records.filter((record) => record.status === 'already_fixed').length,
    needsHuman: records.filter((record) => record.status === 'needs_human').length,
    reopened: records.filter((record) => record.status === 'reopened').length,
  }

  return [
    `Done reason: ${result.doneReason}`,
    `Rounds executed: ${result.rounds}`,
    `Closed issues: ${counts.closed}`,
    `Rejected issues: ${counts.rejected}`,
    `Already fixed: ${counts.alreadyFixed}`,
    `Needs human: ${counts.needsHuman}`,
    `Reopened issues: ${counts.reopened}`,
  ].join('\n')
}
