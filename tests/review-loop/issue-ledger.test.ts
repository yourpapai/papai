// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  applyMatchedIssues,
  closeUnreportedFixed,
  createIssueLedger,
  loadIssueLedger,
  recordFixAttempt,
  recordVerification,
  saveIssueLedger,
} from '../../review-loop/src/issue-ledger.js'
import type { IssueMatch, ReviewerIssue, VerifierDecision } from '../../review-loop/src/issue-schema.js'

const tempDirs: string[] = []

const issue: ReviewerIssue = {
  title: 'Race condition in queue flush path',
  severity: 'high',
  summary: 'Two concurrent messages can bypass the intended lock.',
  whyItMatters: 'This can produce stale assistant replies.',
  evidence: 'src/message-queue/queue.ts lines 84-107',
  file: 'src/message-queue/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Take the processing lock earlier.',
  confidence: 0.92,
}

const validDecision: VerifierDecision = {
  verdict: 'valid',
  fixability: 'auto',
  reasoning: 'The control flow is actually unsafe.',
  targetFiles: ['src/message-queue/queue.ts'],
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('issue ledger', () => {
  test('creates new records for unmatched issues', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const matches: IssueMatch[] = [{ newIssueIndex: 0, existingId: null }]

    const records = applyMatchedIssues(ledger, 1, [issue], matches)

    expect(records).toHaveLength(1)
    expect(records[0]?.id).toBeDefined()
    expect(records[0]?.status).toBe('discovered')
    expect(records[0]?.firstSeenRound).toBe(1)
  })

  test('reopens existing record when matched', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const records1 = applyMatchedIssues(ledger, 1, [issue], [{ newIssueIndex: 0, existingId: null }])
    const id = records1[0]!.id

    recordVerification(ledger, id, validDecision)
    recordFixAttempt(ledger, id)
    ledger.snapshot.issues[id]!.status = 'closed'

    const issueRephrased: ReviewerIssue = {
      ...issue,
      title: 'Race condition when flushing the message queue',
      summary: 'Concurrent flush calls can interleave.',
    }

    applyMatchedIssues(ledger, 2, [issueRephrased], [{ newIssueIndex: 0, existingId: id }])
    await saveIssueLedger(ledger)
    const loaded = await loadIssueLedger(runDir)

    expect(loaded.snapshot.issues[id]?.status).toBe('reopened')
    expect(loaded.snapshot.issues[id]?.issue.title).toBe('Race condition when flushing the message queue')
    expect(loaded.snapshot.issues[id]?.fixAttempts).toBe(1)
  })

  test('closeUnreportedFixed marks fixed_pending_review as closed when not in current round', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const records = applyMatchedIssues(ledger, 1, [issue], [{ newIssueIndex: 0, existingId: null }])
    const id = records[0]!.id

    recordVerification(ledger, id, validDecision)
    recordFixAttempt(ledger, id)

    closeUnreportedFixed(ledger, [id])

    expect(ledger.snapshot.issues[id]?.status).toBe('fixed_pending_review')

    closeUnreportedFixed(ledger, [])

    expect(ledger.snapshot.issues[id]?.status).toBe('closed')
  })

  test('persists and loads correctly', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    applyMatchedIssues(ledger, 1, [issue], [{ newIssueIndex: 0, existingId: null }])
    await saveIssueLedger(ledger)

    const loaded = await loadIssueLedger(runDir)
    expect(Object.keys(loaded.snapshot.issues)).toHaveLength(1)
  })
})
