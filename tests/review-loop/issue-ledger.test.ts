import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createIssueLedger,
  applyReviewRound,
  IssueLedgerSnapshotSchema,
  loadIssueLedger,
  recordVerification,
  recordFixAttempt,
  saveIssueLedger,
} from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from '../../review-loop/src/issue-schema.js'

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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('issue ledger', () => {
  test('deduplicates repeated issues within the same review round', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const duplicateIssues = [issue, { ...issue }]

    const records = applyReviewRound(ledger, 1, duplicateIssues)

    expect(records).toHaveLength(1)
    expect(records[0]?.fingerprint).toBeDefined()
    expect(Object.keys(ledger.snapshot.issues)).toHaveLength(1)
  })

  test('distinguishes invalid and already_fixed verification statuses', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const [invalidRecord, alreadyFixedRecord] = applyReviewRound(ledger, 1, [
      issue,
      {
        ...issue,
        title: 'Queue flush race is already fixed',
        summary: 'The lock now protects the flush path.',
      },
    ])

    expect(invalidRecord).toBeDefined()
    expect(alreadyFixedRecord).toBeDefined()

    recordVerification(ledger, invalidRecord!.fingerprint, {
      verdict: 'invalid',
      fixability: 'manual',
      reasoning: 'The bug report is not supported by the current code.',
      targetFiles: ['src/message-queue/queue.ts'],
      needsPlanning: false,
    })
    recordVerification(ledger, alreadyFixedRecord!.fingerprint, {
      verdict: 'already_fixed',
      fixability: 'manual',
      reasoning: 'The implementation already contains the described fix.',
      targetFiles: ['src/message-queue/queue.ts'],
      needsPlanning: false,
    })

    await saveIssueLedger(ledger)
    const loaded = await loadIssueLedger(runDir)

    expect(loaded.snapshot.issues[invalidRecord!.fingerprint]?.status).toBe('rejected')
    expect(loaded.snapshot.issues[alreadyFixedRecord!.fingerprint]?.status).toBe('already_fixed')
    expect(loaded.snapshot.issues[invalidRecord!.fingerprint]?.verifierDecision?.verdict).toBe('invalid')
    expect(loaded.snapshot.issues[alreadyFixedRecord!.fingerprint]?.verifierDecision?.verdict).toBe('already_fixed')
  })

  test('reopens closed issues when the reviewer reports them again', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const record = applyReviewRound(ledger, 1, [issue])[0]
    expect(record).toBeDefined()

    const decision: VerifierDecision = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'The control flow is actually unsafe.',
      targetFiles: ['src/message-queue/queue.ts'],
      needsPlanning: false,
    }

    recordVerification(ledger, record!.fingerprint, decision)
    recordFixAttempt(ledger, record!.fingerprint)
    ledger.snapshot.issues[record!.fingerprint]!.status = 'closed'
    applyReviewRound(ledger, 2, [issue])
    await saveIssueLedger(ledger)
    const persisted = await loadIssueLedger(runDir)

    expect(persisted.snapshot.issues[record!.fingerprint]?.status).toBe('reopened')
    expect(persisted.snapshot.issues[record!.fingerprint]?.fixAttempts).toBe(1)
  })

  test('reopens fixed pending review issues when the reviewer reports them again', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const record = applyReviewRound(ledger, 1, [issue])[0]
    expect(record).toBeDefined()

    const decision: VerifierDecision = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'The control flow is actually unsafe.',
      targetFiles: ['src/message-queue/queue.ts'],
      needsPlanning: false,
    }

    recordVerification(ledger, record!.fingerprint, decision)
    recordFixAttempt(ledger, record!.fingerprint)
    applyReviewRound(ledger, 2, [issue])
    await saveIssueLedger(ledger)

    const persisted = IssueLedgerSnapshotSchema.parse(JSON.parse(readFileSync(ledger.path, 'utf8')))

    expect(persisted.issues[record!.fingerprint]?.status).toBe('reopened')
    expect(persisted.issues[record!.fingerprint]?.fixAttempts).toBe(1)
  })
})
