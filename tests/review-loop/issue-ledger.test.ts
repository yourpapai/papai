// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { FixerResultSchema } from '../../review-loop/src/issue-schema.js'
import type { IssueMatch, ReviewerIssue, VerifierDecision } from '../../review-loop/src/issue-schema.js'

const tempDirs: string[] = []

const issue: ReviewerIssue = {
  title: 'Race condition in queue flush path',
  kind: 'defect',
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

  test('valid + manual maps to needs_human (terminal); valid + auto maps to verified', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const records = applyMatchedIssues(
      ledger,
      1,
      [issue, { ...issue, title: 'Second issue' }],
      [
        { newIssueIndex: 0, existingId: null },
        { newIssueIndex: 1, existingId: null },
      ],
    )
    const manualId = records[0]!.id
    const autoId = records[1]!.id

    recordVerification(ledger, manualId, { ...validDecision, fixability: 'manual' })
    recordVerification(ledger, autoId, { ...validDecision, fixability: 'auto' })

    expect(ledger.snapshot.issues[manualId]?.status).toBe('needs_human')
    expect(ledger.snapshot.issues[autoId]?.status).toBe('verified')
  })

  test('plan_drift maps to needs_human (terminal)', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const records = applyMatchedIssues(ledger, 1, [issue], [{ newIssueIndex: 0, existingId: null }])
    const id = records[0]!.id

    recordVerification(ledger, id, {
      verdict: 'plan_drift',
      fixability: 'manual',
      reasoning: 'code diverged from plan',
      targetFiles: [],
    })

    expect(ledger.snapshot.issues[id]?.status).toBe('needs_human')
  })
})

describe('issue kind on the ledger', () => {
  test('a ledger written before cleanups existed loads as all-defects', async () => {
    // The ledger is Zod-validated on read and persists across --resume-run, so
    // a snapshot from an earlier run must keep loading. It holds only defects
    // by construction — cleanups could not be reported yet — so the default is
    // a true statement about that file, not a fallback.
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const { kind: _dropped, ...issueWithoutKind } = issue
    writeFileSync(
      path.join(runDir, 'ledger.json'),
      JSON.stringify({
        issues: {
          'issue-1': {
            id: 'issue-1',
            issue: issueWithoutKind,
            status: 'discovered',
            firstSeenRound: 1,
            latestSeenRound: 1,
            fixAttempts: 0,
            verifierDecision: null,
          },
        },
      }),
    )

    const ledger = await loadIssueLedger(runDir)
    expect(ledger.snapshot.issues['issue-1']?.issue.kind).toBe('defect')
  })

  test('a fixer result cannot change the recorded kind', async () => {
    // The kind is the reviewer's answer. FixerResultSchema carries no `kind`,
    // so one asserted in a reply is stripped before it can reach the ledger —
    // this pins that, because adding the field there would silently make the
    // fixer able to reclassify its own issue out of the defect queue.
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const cleanup: ReviewerIssue = { ...issue, kind: 'cleanup' }
    const records = applyMatchedIssues(ledger, 1, [cleanup], [{ newIssueIndex: 0, existingId: null }])
    const id = records[0]!.id

    const parsed = FixerResultSchema.parse({
      ...validDecision,
      fixed: true,
      kind: 'defect',
    })
    expect(parsed).not.toHaveProperty('kind')

    recordVerification(ledger, id, validDecision)
    expect(ledger.snapshot.issues[id]?.issue.kind).toBe('cleanup')
  })

  test('a theme issue with spans creates one ledger record and round-trips', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const themed: ReviewerIssue = {
      ...issue,
      title: 'Un-migrated English literals',
      spans: [
        { file: 'src/a.ts', lineStart: 1, lineEnd: 2, evidence: 'e1' },
        { file: 'src/b.ts', lineStart: 3, lineEnd: 4, evidence: 'e2' },
        { file: 'src/c.ts', lineStart: 5, lineEnd: 6, evidence: 'e3' },
      ],
    }
    const records = applyMatchedIssues(ledger, 1, [themed], [{ newIssueIndex: 0, existingId: null }])
    expect(records).toHaveLength(1)
    expect(records[0]?.issue.spans).toHaveLength(3)

    await saveIssueLedger(ledger)
    const loaded = await loadIssueLedger(runDir)
    const loadedIssue = loaded.snapshot.issues[records[0]!.id]?.issue
    expect(loadedIssue?.spans).toHaveLength(3)
    expect(loadedIssue?.spans?.[1]?.file).toBe('src/b.ts')
  })

  test('reopening a theme issue preserves spans update', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const themed: ReviewerIssue = {
      ...issue,
      spans: [{ file: 'src/a.ts', lineStart: 1, lineEnd: 2, evidence: 'e1' }],
    }
    const records = applyMatchedIssues(ledger, 1, [themed], [{ newIssueIndex: 0, existingId: null }])
    const id = records[0]!.id
    const rec = ledger.snapshot.issues[id]!
    rec.status = 'closed'
    const themed2: ReviewerIssue = {
      ...themed,
      spans: [
        { file: 'src/a.ts', lineStart: 1, lineEnd: 2, evidence: 'e1' },
        { file: 'src/b.ts', lineStart: 3, lineEnd: 4, evidence: 'e2' },
      ],
    }
    applyMatchedIssues(ledger, 2, [themed2], [{ newIssueIndex: 0, existingId: id }])
    expect(ledger.snapshot.issues[id]?.issue.spans).toHaveLength(2)
    expect(ledger.snapshot.issues[id]?.status).toEqual('reopened')
  })
})
