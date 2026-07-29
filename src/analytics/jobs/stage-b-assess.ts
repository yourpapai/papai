// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { GovernanceReadiness } from '../governance/policy-store.js'
import type { RolloutDecision, StageBDayEvidence } from '../rollout/stage-gates.js'
import { STAGE_B_REQUIRED_CONSECUTIVE_WEEKS, assessStageBWindow, assessStageCEntry } from '../rollout/stage-gates.js'
import type { StageBDayReport } from './stage-b-report.js'

const log = logger.child({ scope: 'analytics:jobs:stage-b-assess' })

const isRecordLike = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isStageBDayRecord = (value: unknown): value is StageBDayReport => {
  if (!isRecordLike(value)) return false
  return (
    typeof value['day'] === 'string' &&
    typeof value['completeUtcDay'] === 'boolean' &&
    typeof value['eligible'] === 'boolean' &&
    typeof value['reason'] === 'string'
  )
}

export const parseStageBLog = (jsonl: string): StageBDayReport[] => {
  const byDay = new Map<string, StageBDayReport>()
  const lines = jsonl.split('\n')
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const lineNumber = index + 1
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      log.warn({ lineNumber }, 'skipping unparseable stage-b log line')
      continue
    }
    if (!isStageBDayRecord(parsed)) {
      log.warn({ lineNumber }, 'skipping malformed stage-b log line')
      continue
    }
    byDay.set(parsed.day, parsed)
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
}

const toDayEvidence = (report: StageBDayReport): StageBDayEvidence => ({
  utcDay: report.day,
  completeUtcDay: report.completeUtcDay,
  reconciliationStatus:
    report.reason === 'restart_gap' ? 'unreconciled_restart_gap' : report.eligible ? 'complete_epoch' : 'delta',
})

export const assessRecordedWindow = (
  records: readonly StageBDayReport[],
  readiness: GovernanceReadiness,
): Readonly<{ consecutiveCompleteWeeks: number; stageBExit: boolean; stageCEntry: RolloutDecision }> => {
  const days = records.map(toDayEvidence)
  const window = assessStageBWindow(days)
  return {
    consecutiveCompleteWeeks: window.consecutiveCompleteWeeks,
    stageBExit: window.consecutiveCompleteWeeks >= STAGE_B_REQUIRED_CONSECUTIVE_WEEKS,
    stageCEntry: assessStageCEntry({ governance: readiness, stageBDays: days }),
  }
}
