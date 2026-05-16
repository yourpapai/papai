// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { computeIssueFingerprint } from './issue-fingerprint.js'
import { ReviewerIssueSchema, VerifierDecisionSchema } from './issue-schema.js'
import type { ReviewerIssue, VerifierDecision } from './issue-schema.js'

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
  fingerprint: z.string(),
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
  fingerprint: string
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

export function applyReviewRound(
  ledger: IssueLedger,
  round: number,
  issues: readonly ReviewerIssue[],
): readonly LedgerIssueRecord[] {
  const seenFingerprints = new Set<string>()
  const roundRecords: LedgerIssueRecord[] = []

  for (const issue of issues) {
    const fingerprint = computeIssueFingerprint(issue)
    if (seenFingerprints.has(fingerprint)) {
      continue
    }
    seenFingerprints.add(fingerprint)

    const existing = ledger.snapshot.issues[fingerprint]

    const next: LedgerIssueRecord =
      existing === undefined
        ? {
            fingerprint,
            issue,
            status: 'discovered',
            firstSeenRound: round,
            latestSeenRound: round,
            fixAttempts: 0,
            verifierDecision: null,
          }
        : {
            ...existing,
            issue,
            latestSeenRound: round,
            status:
              existing.status === 'closed' || existing.status === 'fixed_pending_review' ? 'reopened' : existing.status,
          }

    ledger.snapshot.issues[fingerprint] = next
    roundRecords.push(next)
  }

  return roundRecords
}

export function recordVerification(ledger: IssueLedger, fingerprint: string, decision: VerifierDecision): void {
  const record = ledger.snapshot.issues[fingerprint]
  if (record === undefined) {
    throw new Error(`Unknown issue fingerprint ${fingerprint}`)
  }

  record.verifierDecision = decision
  record.status = mapVerifierDecisionToLedgerStatus(decision.verdict)
}

export function recordFixAttempt(ledger: IssueLedger, fingerprint: string): void {
  const record = ledger.snapshot.issues[fingerprint]
  if (record === undefined) {
    throw new Error(`Unknown issue fingerprint ${fingerprint}`)
  }

  record.fixAttempts += 1
  record.status = 'fixed_pending_review'
}

export async function saveIssueLedger(ledger: IssueLedger): Promise<void> {
  await writeFile(ledger.path, JSON.stringify(ledger.snapshot, null, 2))
}

function mapVerifierDecisionToLedgerStatus(verdict: VerifierDecision['verdict']): LedgerIssueStatus {
  switch (verdict) {
    case 'valid':
      return 'verified'
    case 'already_fixed':
      return 'already_fixed'
    case 'needs_human':
      return 'needs_human'
    case 'invalid':
      return 'rejected'
    default:
      throw new Error('Unhandled verifier verdict')
  }
}
