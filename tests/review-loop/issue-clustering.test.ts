// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
import { describe, expect, test } from 'bun:test'

import { clusterRecords } from '../../review-loop/src/issue-clustering.js'
import type { LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'

function makeRecord(overrides: Partial<ReviewerIssue> & { id?: string }): LedgerIssueRecord {
  const base: ReviewerIssue = {
    title: 'English literal left un-localized',
    kind: 'cleanup',
    severity: 'low',
    summary: 'English string inside localized envelope',
    whyItMatters: 'i18n completeness',
    evidence: 'src/chat/index.ts:10 hardcoded English',
    file: 'src/chat/index.ts',
    lineStart: 10,
    lineEnd: 10,
    suggestedFix: 'wrap with t()',
    confidence: 0.9,
  }
  const issue = { ...base, ...overrides } as ReviewerIssue
  // preserve id override if provided in ReviewerIssue shape confusion
  const id = (overrides as { id?: string }).id ?? `id-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    issue,
    status: 'discovered',
    firstSeenRound: 1,
    latestSeenRound: 1,
    fixAttempts: 0,
    verifierDecision: null,
  }
}

describe('issue-clustering', () => {
  test('theme issue with spans stays as one batch', () => {
    const themed = makeRecord({
      id: 'theme-1',
      title: 'Un-migrated English literals',
      spans: [
        { file: 'src/a.ts', lineStart: 1, lineEnd: 2, evidence: 'e1' },
        { file: 'src/b.ts', lineStart: 3, lineEnd: 4, evidence: 'e2' },
      ],
    })
    const clusters = clusterRecords([themed])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.records).toHaveLength(1)
    expect(clusters[0]!.records[0]!.id).toBe('theme-1')
  })

  test('flat pending with shared n-gram clusters together', () => {
    const a = makeRecord({ id: 'a', title: 'English literal not localized in chat', file: 'src/chat/a.ts' })
    const b = makeRecord({ id: 'b', title: 'English string not localized in chat', file: 'src/chat/b.ts' })
    const c = makeRecord({ id: 'c', title: 'English literal not localized in chat', file: 'src/chat/c.ts' })
    const clusters = clusterRecords([a, b, c])
    // all three share English + localized n-gram and same kind → one batch
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.records.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })

  test('defect vs cleanup never co-cluster', () => {
    const defect = makeRecord({ id: 'def', kind: 'defect', title: 'English literal not localized defect' })
    const cleanup = makeRecord({ id: 'clean', kind: 'cleanup', title: 'English literal not localized cleanup' })
    const clusters = clusterRecords([defect, cleanup])
    expect(clusters).toHaveLength(2)
    // kind-first ordering: defect first
    expect(clusters[0]!.records[0]!.issue.kind).toBe('defect')
    expect(clusters[1]!.records[0]!.issue.kind).toBe('cleanup')
  })

  test('different n-grams do not cluster', () => {
    const a = makeRecord({ id: 'a', title: 'English literal not localized' })
    const b = makeRecord({ id: 'b', title: 'Race condition in queue' })
    const clusters = clusterRecords([a, b])
    expect(clusters).toHaveLength(2)
  })

  test('kind-first ordering preserved across clusters', () => {
    const lowCleanup = makeRecord({
      id: 'lc',
      kind: 'cleanup',
      severity: 'low',
      title: 'English literal not localized',
    })
    const highDefect = makeRecord({ id: 'hd', kind: 'defect', severity: 'high', title: 'Critical defect' })
    const clusters = clusterRecords([lowCleanup, highDefect])
    expect(clusters[0]!.records[0]!.id).toBe('hd')
    expect(clusters[1]!.records[0]!.id).toBe('lc')
  })
})
