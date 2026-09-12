// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  acceptMember,
  claimedFilesOf,
  noCommitMember,
  rejectMember,
  type BatchMember,
} from '../../review-loop/src/batch-outcomes.js'
import type { IssueLedger, LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import { createIssueLedger } from '../../review-loop/src/issue-ledger.js'
import type { IssueProcessorDeps } from '../../review-loop/src/issue-processor.js'
import type { FixerResult, ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { newCollector, type RoundCollector } from '../../review-loop/src/round-collector.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import type { TraceEvent } from '../../review-loop/src/trace-log.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir, silentReporter } from './test-helpers.js'

afterEach(cleanupTempDirs)

const issue: ReviewerIssue = {
  title: 'English literal not localized',
  kind: 'defect',
  severity: 'low',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'src/a.ts 1-2',
  file: 'src/a.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'localize',
  confidence: 0.9,
}

const fixerResult: FixerResult = {
  verdict: 'valid',
  fixability: 'auto',
  fixed: true,
  reasoning: 'fixed it',
  targetFiles: ['fix-rec-a.ts'],
  severity: 'low',
}

function buildMember(overrides?: Partial<ReviewerIssue>): BatchMember {
  const record: LedgerIssueRecord = {
    id: 'rec-a',
    issue: { ...issue, ...overrides },
    status: 'discovered',
    firstSeenRound: 1,
    latestSeenRound: 1,
    fixAttempts: 0,
    verifierDecision: null,
  }
  return { record, fixerResult }
}

interface OutcomeScenario {
  deps: IssueProcessorDeps
  ledger: IssueLedger
  collector: RoundCollector
  events: TraceEvent[]
}

async function setupOutcome(member: BatchMember): Promise<OutcomeScenario> {
  const repoRoot = makeTempDir('batch-outcome-')
  const config = createReviewLoopConfigFixture(repoRoot)
  writeFileSync(path.join(repoRoot, 'plan.md'), '# Plan')
  const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
  const ledger = await createIssueLedger(runState.runDir)
  ledger.snapshot.issues[member.record.id] = member.record
  const collector = newCollector()
  const { logger, events } = createCapturingTraceLogger()
  const deps: IssueProcessorDeps = {
    config,
    runState,
    ledger,
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    log: silentReporter(),
    trace: logger,
    pool: {
      acquire: () => {
        throw new Error('not used')
      },
      release: () => {},
      mergeWorkerIntoPrimary: () => Promise.resolve({ ok: true }),
      primaryWorktreePath: '/tmp/fake',
      primaryBranch: 'fake',
      workerPaths: () => [],
      close: () => Promise.resolve(),
    },
  }
  return { deps, ledger, collector, events }
}

describe('claimedFilesOf', () => {
  test('unions issue spans with fixer targetFiles', () => {
    const member = buildMember({
      spans: [
        { file: 'src/a.ts', lineStart: 1, lineEnd: 2, evidence: 'e1' },
        { file: 'src/b.ts', lineStart: 3, lineEnd: 4, evidence: 'e2' },
      ],
    })
    expect(claimedFilesOf([member])).toEqual(new Set(['src/a.ts', 'src/b.ts', 'fix-rec-a.ts']))
  })

  test('falls back to the primary span when the issue has no spans array', () => {
    expect(claimedFilesOf([buildMember()])).toEqual(new Set(['src/a.ts', 'fix-rec-a.ts']))
  })
})

describe('rejectMember', () => {
  test('records needs_human, tallies the given decision, and emits a failed fix_complete', async () => {
    const member = buildMember()
    const { deps, ledger, collector, events } = await setupOutcome(member)

    rejectMember(deps, 1, collector, member, 'Inspector rejected: wrong file', 'inspector_rejected')

    const record = ledger.snapshot.issues['rec-a']
    expect(record?.status).toBe('needs_human')
    expect(record?.verifierDecision?.verdict).toBe('needs_human')
    expect(record?.verifierDecision?.reasoning).toBe('Inspector rejected: wrong file')
    expect(collector.decisions.inspector_rejected).toBe(1)
    expect(collector.fixerSeverity.low).toBe(1)
    const complete = events.find((e) => e.event === 'fix_complete')
    expect(complete).toMatchObject({ issueId: 'rec-a', fixed: false })
  })
})

describe('noCommitMember', () => {
  test('counts no_commit without changing the recorded verifier decision', async () => {
    const member = buildMember()
    const { deps, ledger, collector, events } = await setupOutcome(member)

    noCommitMember(deps, 1, collector, member)

    expect(collector.decisions.no_commit).toBe(1)
    // The verdict stays whatever it was: no_commit is a claim about the diff,
    // not a verdict change, so this path records no new decision.
    expect(ledger.snapshot.issues['rec-a']?.verifierDecision).toBeNull()
    expect(events.find((e) => e.event === 'fix_complete')).toMatchObject({ fixed: false })
  })
})

describe('acceptMember', () => {
  test('records the fix attempt, tallies fixed with the check-behind answer, and emits the commit sha', async () => {
    const member = buildMember()
    const { deps, ledger, collector, events } = await setupOutcome(member)

    acceptMember(deps, 1, collector, member, 'with-check', 'abc123')

    const record = ledger.snapshot.issues['rec-a']
    expect(record?.status).toBe('fixed_pending_review')
    expect(record?.fixAttempts).toBe(1)
    expect(collector.decisions.fixed).toBe(1)
    expect(collector.checkBehind.defect.withCheck).toBe(1)
    expect(events.find((e) => e.event === 'fix_complete')).toMatchObject({
      issueId: 'rec-a',
      fixed: true,
      commitSha: 'abc123',
    })
  })
})
