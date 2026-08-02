// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Shared synthetic fixtures for the Gate 0 acceptance harness.
 *
 * SYNTHETIC ONLY. Never add real conversation content here — the harness satisfies the
 * roadmap's privacy-review requirement by construction, not by process.
 *
 * Bump CORPUS_VERSION whenever a fixture changes, so a shifting corpus cannot silently
 * change what "passing" meant. The report renders this value.
 */

import { saveMemoryRecord } from '../../../src/long-term-memory/store.js'
import type { MemoryRecordInput, MemoryScope, MemoryStatus } from '../../../src/long-term-memory/types.js'

export const CORPUS_VERSION = '2026-08-02.1'

export const PERSONAL: MemoryScope = { scopeId: 'acc-personal-1', scopeType: 'personal' }
export const OTHER_PERSONAL: MemoryScope = { scopeId: 'acc-personal-2', scopeType: 'personal' }
export const GROUP: MemoryScope = { scopeId: 'acc-group-1', scopeType: 'group' }

export const MODEL = 'acc-model'
export const VEC = [1, 0, 0]
export const VERSION = `${MODEL}:${VEC.length}`

export const ALL_STATUSES: readonly MemoryStatus[] = ['active', 'stale', 'archived', 'contradicted', 'provisional']

const BASE_TIME = '2026-07-01T00:00:00.000Z'

/** Bilingual pair driving every `multilingual` cell. Terms are chosen to tokenize under unicode61. */
export const BILINGUAL = [
  { lang: 'EN', id: 'acc-en-1', content: 'User lives in Berlin', term: 'Berlin' },
  { lang: 'RU', id: 'acc-ru-1', content: 'Пользователь живёт в Берлине', term: 'Берлине' },
] as const

export const acceptanceRecord = (
  overrides: Partial<MemoryRecordInput> & Readonly<{ id: string; content: string }>,
): MemoryRecordInput => ({
  scopeId: PERSONAL.scopeId,
  scopeType: PERSONAL.scopeType,
  kind: 'fact',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: BASE_TIME,
  updatedAt: BASE_TIME,
  lastSeenAt: BASE_TIME,
  embedding: new Float32Array(VEC),
  embeddingModel: MODEL,
  embeddingDimension: VEC.length,
  embeddingVersion: VERSION,
  embeddedAt: BASE_TIME,
  ...overrides,
})

const write = (input: MemoryRecordInput): string => {
  const saved = saveMemoryRecord(input)
  if (saved === null) throw new Error(`corpus write suppressed for ${input.id}`)
  return saved.id
}

export function seedMultilingual(scope: MemoryScope): readonly string[] {
  return BILINGUAL.map((entry) =>
    write(acceptanceRecord({ ...scope, id: `${scope.scopeId}-${entry.id}`, content: entry.content })),
  )
}

export function seedMultiParty(): readonly string[] {
  return [
    write(acceptanceRecord({ ...PERSONAL, id: 'acc-mp-personal', content: 'Alice prefers dark mode' })),
    write(acceptanceRecord({ ...OTHER_PERSONAL, id: 'acc-mp-other', content: 'Bob prefers light mode' })),
    write(
      acceptanceRecord({
        ...GROUP,
        id: 'acc-mp-group',
        content: 'The team stands up at nine',
        evidence: { actorIds: ['alice', 'bob'] },
      }),
    ),
    write(
      acceptanceRecord({
        ...GROUP,
        id: 'acc-mp-group-thread',
        content: 'The release thread targets Friday',
        threadContextId: 'thread-a',
        evidence: { actorIds: ['alice'], threads: ['thread-a'] },
      }),
    ),
  ]
}

export function seedToolResult(scope: MemoryScope): readonly string[] {
  return [
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-tool-1`,
        content: 'Task PAP-42 was moved to In Progress',
        source: 'tool_result',
        evidence: { messageIds: ['msg-tool-1'], contextId: scope.scopeId, timestamps: [BASE_TIME] },
      }),
    ),
  ]
}

/**
 * Supersession is expressed through `status`, never through a past `validUntil`:
 * `listMemoryRecords` applies `recordValidityCondition(now)`, so a closed validity window
 * would make the superseded record invisible and the fixture untestable at wall-clock time.
 */
export function seedContradiction(scope: MemoryScope): readonly string[] {
  return [
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-old`,
        content: 'User lives in Berlin',
        status: 'contradicted',
        evidence: { timestamps: [BASE_TIME] },
      }),
    ),
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-new`,
        content: 'User lives in Hamburg',
        evidence: { timestamps: ['2026-07-02T00:00:00.000Z'] },
      }),
    ),
  ]
}

export function seedMissingEmbedding(scope: MemoryScope): readonly string[] {
  return [
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-noembed`,
        content: 'User speaks Portuguese',
        embedding: null,
        embeddingModel: null,
        embeddingDimension: null,
        embeddingVersion: null,
        embeddedAt: null,
      }),
    ),
  ]
}

export function seedDuplicateOutOfOrder(scope: MemoryScope): readonly string[] {
  const content = 'User drinks oat milk'
  return [
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-dup-late`,
        content,
        createdAt: '2026-07-05T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
        lastSeenAt: '2026-07-05T00:00:00.000Z',
      }),
    ),
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-dup-early`,
        content,
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
        lastSeenAt: '2026-07-03T00:00:00.000Z',
      }),
    ),
  ]
}

/**
 * A twelve-month horizon: twelve distinct facts, one per month, whose event times span far
 * enough that lexical or insertion-order ordering would diverge from event-time ordering. Each
 * entry projects to its own shadow row under its own identity — no entry restates another
 * month's content, so this fixture does not exercise cross-month supersession.
 */
export function seedLongHorizon(scope: MemoryScope): readonly string[] {
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
  const written = months.map((month) => {
    const stamp = `2025-${month}-01T00:00:00.000Z`
    return write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-horizon-${month}`,
        content: `Month ${month} status was recorded`,
        createdAt: stamp,
        updatedAt: stamp,
        lastSeenAt: stamp,
        evidence: { timestamps: [stamp] },
      }),
    )
  })
  return written
}

export function seedAdversarialErasure(scope: MemoryScope): readonly string[] {
  const content = 'User banks with Sparkasse'
  return [
    write(acceptanceRecord({ ...scope, id: `${scope.scopeId}-acc-adv-active`, content })),
    write(acceptanceRecord({ ...scope, id: `${scope.scopeId}-acc-adv-twin`, content, status: 'provisional' })),
  ]
}
