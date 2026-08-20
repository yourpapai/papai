// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { ReviewerIssueSchema, VerifierDecisionSchema } from './issue-schema.js'
import type { FixerResult, IssueMatch, ReviewerIssue, VerifierDecision } from './issue-schema.js'
import { emitVerifyComplete, truncate } from './loop-trace.js'
import { exposureKind } from './round-collector.js'
import type { TraceLogger } from './trace-log.js'

export type LedgerIssueStatus =
  | 'discovered'
  | 'verified'
  | 'rejected'
  | 'already_fixed'
  | 'needs_human'
  | 'fixed_pending_review'
  | 'closed'
  | 'reopened'

export const LedgerIssueRecordSchema = z.object({
  id: z.string(),
  issue: ReviewerIssueSchema,
  status: z.enum([
    'discovered',
    'verified',
    'rejected',
    'already_fixed',
    'needs_human',
    'fixed_pending_review',
    'closed',
    'reopened',
  ]),
  firstSeenRound: z.number().int().nonnegative(),
  latestSeenRound: z.number().int().nonnegative(),
  fixAttempts: z.number().int().nonnegative(),
  verifierDecision: VerifierDecisionSchema.nullable(),
})

export const IssueLedgerSnapshotSchema = z.object({
  issues: z.record(z.string(), LedgerIssueRecordSchema),
})

export interface LedgerIssueRecord {
  id: string
  issue: ReviewerIssue
  status: LedgerIssueStatus
  firstSeenRound: number
  latestSeenRound: number
  fixAttempts: number
  verifierDecision: VerifierDecision | null
}

export interface IssueLedgerSnapshot {
  issues: Record<string, LedgerIssueRecord>
}

export interface IssueLedger {
  path: string
  snapshot: IssueLedgerSnapshot
}

export async function createIssueLedger(runDir: string): Promise<IssueLedger> {
  const ledger: IssueLedger = {
    path: path.join(runDir, 'ledger.json'),
    snapshot: { issues: {} },
  }
  await saveIssueLedger(ledger)
  return ledger
}

export async function loadIssueLedger(runDir: string): Promise<IssueLedger> {
  const ledgerPath = path.join(runDir, 'ledger.json')
  const snapshot = IssueLedgerSnapshotSchema.parse(JSON.parse(await readFile(ledgerPath, 'utf8')))
  return {
    path: ledgerPath,
    snapshot,
  }
}

function reopenExisting(record: LedgerIssueRecord, issue: ReviewerIssue, round: number): LedgerIssueRecord {
  return {
    ...record,
    issue,
    latestSeenRound: round,
    status: record.status === 'closed' || record.status === 'fixed_pending_review' ? 'reopened' : record.status,
  }
}

function createNewRecord(issue: ReviewerIssue, round: number): LedgerIssueRecord {
  return {
    id: randomUUID(),
    issue,
    status: 'discovered',
    firstSeenRound: round,
    latestSeenRound: round,
    fixAttempts: 0,
    verifierDecision: null,
  }
}

export function applyMatchedIssues(
  ledger: IssueLedger,
  round: number,
  issues: readonly ReviewerIssue[],
  matches: readonly IssueMatch[],
): readonly LedgerIssueRecord[] {
  const roundRecords: LedgerIssueRecord[] = []

  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index]!
    const match = matches.find((m) => m.newIssueIndex === index)
    const existingId = match?.existingId ?? null
    const existing = existingId === null ? undefined : ledger.snapshot.issues[existingId]

    const record = existing === undefined ? createNewRecord(issue, round) : reopenExisting(existing, issue, round)

    ledger.snapshot.issues[record.id] = record
    roundRecords.push(record)
  }

  return roundRecords
}

export function closeUnreportedFixed(ledger: IssueLedger, reportedIds: readonly string[]): void {
  const reported = new Set(reportedIds)
  for (const record of Object.values(ledger.snapshot.issues)) {
    if (record.status === 'fixed_pending_review' && !reported.has(record.id)) {
      record.status = 'closed'
    }
  }
}

export function recordVerification(ledger: IssueLedger, id: string, decision: VerifierDecision): void {
  const record = ledger.snapshot.issues[id]
  if (record === undefined) {
    throw new Error(`Unknown issue id ${id}`)
  }
  record.verifierDecision = decision
  record.status = mapVerifierDecisionToLedgerStatus(decision)
}

export function recordFixAttempt(ledger: IssueLedger, id: string): void {
  const record = ledger.snapshot.issues[id]
  if (record === undefined) {
    throw new Error(`Unknown issue id ${id}`)
  }
  record.fixAttempts += 1
  record.status = 'fixed_pending_review'
}

export async function saveIssueLedger(ledger: IssueLedger): Promise<void> {
  await writeFile(ledger.path, JSON.stringify(ledger.snapshot, null, 2))
}

export function recordVerify(
  ledger: IssueLedger,
  trace: TraceLogger,
  round: number,
  record: LedgerIssueRecord,
  result: FixerResult,
): void {
  recordVerification(ledger, record.id, {
    verdict: result.verdict,
    fixability: result.fixability,
    reasoning: result.reasoning,
    targetFiles: result.targetFiles,
  })
  emitVerifyComplete(
    trace,
    round,
    record.id,
    result.verdict,
    result.fixability,
    {
      reviewerSeverity: record.issue.severity,
      fixerSeverity: result.severity ?? null,
      reviewerExposure: exposureKind(record.issue.exposure),
      fixerExposure: exposureKind(result.exposure),
    },
    truncate(result.reasoning, 200),
    result.targetFiles,
  )
}

export function recordNeedsHuman(
  ledger: IssueLedger,
  trace: TraceLogger,
  round: number,
  record: LedgerIssueRecord,
  reasoning: string,
  result: FixerResult,
): void {
  recordVerification(ledger, record.id, {
    verdict: 'needs_human',
    fixability: 'manual',
    reasoning,
    targetFiles: result.targetFiles,
  })
  emitVerifyComplete(
    trace,
    round,
    record.id,
    'needs_human',
    'manual',
    {
      reviewerSeverity: record.issue.severity,
      fixerSeverity: result.severity ?? null,
      reviewerExposure: exposureKind(record.issue.exposure),
      fixerExposure: exposureKind(result.exposure),
    },
    truncate(reasoning, 200),
    result.targetFiles,
  )
}

function mapVerifierDecisionToLedgerStatus(decision: VerifierDecision): LedgerIssueStatus {
  switch (decision.verdict) {
    case 'valid':
      return decision.fixability === 'manual' ? 'needs_human' : 'verified'
    case 'already_fixed':
      return 'already_fixed'
    case 'needs_human':
      return 'needs_human'
    case 'plan_drift':
      return 'needs_human'
    case 'invalid':
      return 'rejected'
    default:
      throw new Error('Unhandled verifier verdict')
  }
}
