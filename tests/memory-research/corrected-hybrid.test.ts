// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  DENSE_ELIGIBILITY_THRESHOLD,
  createCorrectedHybridCandidate,
} from '../../scripts/memory-research/candidates/corrected-hybrid.js'
import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import { DETERMINISTIC_EMBEDDING_VERSION } from '../../scripts/memory-research/types.js'
import { MemoryEventSchema, MemoryQuerySchema } from '../../scripts/memory-research/types.js'
import type {
  MemoryEntity,
  MemoryEvent,
  MemoryQuery,
  MemoryScenario,
  MemoryScope,
  RawQueryResult,
} from '../../scripts/memory-research/types.js'

const personalScope = { kind: 'personal', id: 'personal-corrected' } as const satisfies MemoryScope
const foreignScope = { kind: 'group', id: 'group-corrected' } as const satisfies MemoryScope
const timestamp = (hour: number): string => `2026-07-23T${hour.toString().padStart(2, '0')}:00:00.000Z`

const event = (
  suffix: string,
  scope: MemoryScope,
  content: string,
  hour: number,
  options: Readonly<{
    available?: boolean
    entities?: readonly MemoryEntity[]
    validTo?: string | null
    version?: string | null
  }> = {},
): MemoryEvent =>
  MemoryEventSchema.parse({
    eventId: `event-${suffix}`,
    evidenceId: `evidence-${suffix}`,
    scope,
    language: 'en',
    eventTime: timestamp(hour),
    ingestTime: timestamp(hour),
    content,
    type: 'fact',
    threadId: null,
    entities: options.entities ?? [],
    relations: [],
    validity: { validFrom: timestamp(hour), validTo: options.validTo ?? null },
    embedding: {
      available: options.available ?? true,
      version: options.available === false ? null : (options.version ?? DETERMINISTIC_EMBEDDING_VERSION),
    },
  })

const query = (
  suffix: string,
  scope: MemoryScope,
  text: string,
  options: Readonly<{ actorRole?: 'owner' | 'member' | 'guest'; k?: number; time?: string; budget?: number }> = {},
): MemoryQuery =>
  MemoryQuerySchema.parse({
    queryId: `query-${suffix}`,
    authorizedScope: scope,
    actorRole: options.actorRole ?? 'owner',
    language: 'en',
    queryTime: options.time ?? timestamp(23),
    k: options.k ?? 8,
    contextTokenBudget: options.budget ?? 512,
    expectedEvidenceIds: [],
    forbiddenEvidenceIds: [],
    erasedEvidenceIds: [],
    slices: ['direct-fact'],
    text,
  })

const missingEmbeddingScenario = (): MemoryScenario => {
  const scenario = memoryScenarios.find(
    ({ language, labels }) => language === 'en' && labels.includes('missing-embedding'),
  )
  if (scenario === undefined) throw new Error('missing English missing-embedding scenario')
  return scenario
}

const successfulResult = (result: RawQueryResult): Extract<RawQueryResult, { status: 'success' }> => {
  if (result.status !== 'success') throw new Error(`expected success, received ${result.status}`)
  return result
}

const hitIds = async (
  candidate: ReturnType<typeof createCorrectedHybridCandidate>,
  lookup: MemoryQuery,
): Promise<readonly string[]> => {
  const result = successfulResult(await candidate.retrieve(lookup))
  return result.hits.map(({ evidenceId }) => evidenceId)
}

describe('corrected hybrid memory candidate', () => {
  test('recovers an unembedded rare identifier alongside an embedded distractor above the shipped threshold', async () => {
    const candidate = createCorrectedHybridCandidate()
    const scenario = missingEmbeddingScenario()
    const target = scenario.events[0]!
    const distractor = scenario.events[1]!
    await candidate.ingest(scenario.events)

    const result = successfulResult(await candidate.retrieve(scenario.queries[0]!))

    expect(result.hits.map(({ evidenceId }) => evidenceId)).toContain(target.evidenceId)
    expect(
      result.hits.find(({ evidenceId }) => evidenceId === distractor.evidenceId)?.score.dense,
    ).toBeGreaterThanOrEqual(0.65)
  })

  test('recovers Unicode Cyrillic lexical evidence with a missing vector', async () => {
    const candidate = createCorrectedHybridCandidate()
    const scope = { kind: 'personal', id: 'personal-cyrillic-corrected' } as const
    const russian = MemoryEventSchema.parse({
      ...event('cyrillic', scope, 'Секретный маркер РУБИН подтвержден.', 10, { available: false }),
      language: 'ru',
    })
    const lookup = MemoryQuerySchema.parse({
      ...query('cyrillic', scope, 'Где подтвержден секретный маркер РУБИН?'),
      language: 'ru',
    })
    await candidate.ingest([russian])

    expect(await hitIds(candidate, lookup)).toEqual([russian.evidenceId])
  })

  test('returns only facts active at query time', async () => {
    const candidate = createCorrectedHybridCandidate()
    const prior = event('prior', personalScope, 'The ORBIT-77 deployment is Monday.', 10, {
      available: false,
      validTo: timestamp(12),
    })
    const current = event('current', personalScope, 'The ORBIT-77 deployment is Tuesday.', 12, { available: false })
    await candidate.ingest([prior, current])

    expect(
      await hitIds(
        candidate,
        query('temporal', personalScope, 'What is ORBIT-77 deployment?', { time: timestamp(20) }),
      ),
    ).toEqual([current.evidenceId])
  })

  test('uses epoch comparisons for offset half-open validity', async () => {
    const candidate = createCorrectedHybridCandidate()
    const offset = MemoryEventSchema.parse({
      ...event('offset', personalScope, 'OFFSET-19 is active.', 10, { available: false }),
      validity: { validFrom: '2026-07-23T12:00:00.000+03:00', validTo: '2026-07-23T13:00:00.000+03:00' },
    })
    await candidate.ingest([offset])
    expect(
      await hitIds(
        candidate,
        query('offset-live', personalScope, 'What is OFFSET-19?', { time: '2026-07-23T09:30:00.000Z' }),
      ),
    ).toEqual([offset.evidenceId])
    expect(
      await hitIds(
        candidate,
        query('offset-ended', personalScope, 'What is OFFSET-19?', { time: '2026-07-23T10:00:00.000Z' }),
      ),
    ).toEqual([])
  })

  test('abstains from dense-only unrelated candidates above no eligibility threshold', async () => {
    const candidate = createCorrectedHybridCandidate()
    await candidate.ingest([event('unrelated', personalScope, 'Coffee is stored beside the ocean.', 10)])
    expect(DENSE_ELIGIBILITY_THRESHOLD).toBeGreaterThan(0)
    expect(
      await hitIds(candidate, query('abstain', personalScope, 'Which deadline belongs to project ORBIT-99?')),
    ).toEqual([])
  })

  test('retains tombstone storage after erasing every record', async () => {
    const candidate = createCorrectedHybridCandidate()
    const record = event('metrics-tombstone', personalScope, 'TOMB-77 remains erased.', 10, { available: false })
    await candidate.ingest([record])
    await candidate.forget({
      kind: 'evidence',
      scope: personalScope,
      evidenceIds: [record.evidenceId],
      completedAt: timestamp(11),
    })
    const metrics = await candidate.resourceMetrics()
    expect(metrics.storedBytes).toBeGreaterThan(0)
    expect(metrics.incrementalRssBytes).toBeGreaterThanOrEqual(0)
  })

  test('charges vector storage only for available embeddings while preserving unavailable lexical retrieval', async () => {
    const unavailable = event('vector-none', personalScope, 'VECTOR-NULL lexical evidence.', 10, { available: false })
    const available = event('vector-present', personalScope, 'VECTOR-NULL lexical evidence.', 10)
    const withoutVector = createCorrectedHybridCandidate()
    const withVector = createCorrectedHybridCandidate()
    await withoutVector.ingest([unavailable])
    await withVector.ingest([available])
    expect((await withVector.resourceMetrics()).storedBytes).toBeGreaterThan(
      (await withoutVector.resourceMetrics()).storedBytes,
    )
    expect(await hitIds(withoutVector, query('vector-none', personalScope, 'What is VECTOR-NULL?'))).toEqual([
      unavailable.evidenceId,
    ])
  })

  test('handles 100k distractors with finite resources and correct abstention', async () => {
    const candidate = createCorrectedHybridCandidate()
    const distractors = Array.from({ length: 100_000 }, (_, index) =>
      event(`smoke-${index}`, personalScope, `Synthetic warehouse note ${index}.`, (index % 20) + 1),
    )
    await candidate.ingest(distractors)
    expect(await hitIds(candidate, query('smoke', personalScope, 'When does the aurora beacon release?'))).toEqual([])
    expect(Object.values(await candidate.resourceMetrics()).every((value) => Number.isFinite(value))).toBeTrue()
  }, 30_000)

  test('keeps incompatible embedding versions lexically eligible without dense comparison', async () => {
    const candidate = createCorrectedHybridCandidate()
    const legacy = event('legacy', personalScope, 'The LEGACY-77 safety token is approved.', 10, {
      version: 'legacy-vector-v0',
    })
    await candidate.ingest([legacy])

    const result = successfulResult(await candidate.retrieve(query('legacy', personalScope, 'What is LEGACY-77?')))

    expect(result).toMatchObject({ status: 'success', hits: [{ evidenceId: legacy.evidenceId }] })
    expect(result.hits[0]!.score.dense).toBe(0)
  })

  test('blocks guest reads and supplied-hit context', async () => {
    const candidate = createCorrectedHybridCandidate()
    const groupRecord = event('guest', foreignScope, 'The group secret is VIOLET-92.', 10, { available: false })
    await candidate.ingest([groupRecord])
    const lookup = query('guest', foreignScope, 'What is VIOLET-92?', { actorRole: 'guest' })

    expect(await candidate.retrieve(lookup)).toMatchObject({ status: 'success', hits: [] })
    expect(await candidate.assembleContext(lookup, [])).toEqual({ text: '', evidenceIds: [], tokenCount: 0 })
  })

  test('hard evidence, subject, and scope erasure reject later recapture', async () => {
    const candidate = createCorrectedHybridCandidate()
    const subject: MemoryEntity = { entityId: 'subject-corrected', type: 'person', name: 'Subject', aliases: [] }
    const evidenceRecord = event('erase-evidence', personalScope, 'The ERASE-01 token exists.', 10, {
      available: false,
    })
    const subjectRecord = event('erase-subject', personalScope, 'Subject has SUBJECT-02 token.', 11, {
      available: false,
      entities: [subject],
    })
    const scopeRecord = event('erase-scope', foreignScope, 'Group has SCOPE-03 token.', 12, { available: false })
    await candidate.ingest([evidenceRecord, subjectRecord, scopeRecord])
    await candidate.forget({
      kind: 'evidence',
      scope: personalScope,
      evidenceIds: [evidenceRecord.evidenceId],
      completedAt: timestamp(13),
    })
    await candidate.forget({
      kind: 'subject',
      scope: personalScope,
      subjectId: subject.entityId,
      completedAt: timestamp(14),
    })
    await candidate.forget({ kind: 'scope', scope: foreignScope, completedAt: timestamp(15) })
    await candidate.ingest([
      evidenceRecord,
      subjectRecord,
      event('erase-scope-recapture', foreignScope, 'Group has SCOPE-03 replacement.', 16, { available: false }),
    ])

    expect(await hitIds(candidate, query('erased-evidence', personalScope, 'What is ERASE-01?'))).toEqual([])
    expect(await hitIds(candidate, query('erased-subject', personalScope, 'What is SUBJECT-02?'))).toEqual([])
    expect(await hitIds(candidate, query('erased-scope', foreignScope, 'What is SCOPE-03?'))).toEqual([])
  })

  test('isolates exact scopes and orders fused ties by stable evidence id', async () => {
    const candidate = createCorrectedHybridCandidate()
    const localB = event('tie-b', personalScope, 'exact fusion token', 10, { available: false })
    const localA = event('tie-a', personalScope, 'exact fusion token', 10, { available: false })
    const foreign = event('foreign', foreignScope, 'exact fusion token', 10, { available: false })
    await candidate.ingest([localB, foreign, localA])

    expect(await hitIds(candidate, query('fusion', personalScope, 'exact fusion token'))).toEqual([
      localA.evidenceId,
      localB.evidenceId,
    ])
  })

  test('assembles only supplied relevant hits in their order within budget and rebuild agrees', async () => {
    const records = [
      event('context-first', personalScope, 'first included', 10, { available: false }),
      event('context-second', personalScope, 'second included', 11, { available: false }),
      event('context-extra', personalScope, 'extra not supplied', 12, { available: false }),
    ]
    const lookup = query('context', personalScope, 'included', { budget: 2 })
    const incremental = createCorrectedHybridCandidate()
    const rebuilt = createCorrectedHybridCandidate()
    await incremental.ingest(records)
    const supplied = successfulResult(await incremental.retrieve(lookup))
    const context = await incremental.assembleContext(lookup, supplied.hits)
    expect(context).toEqual({ text: records[0]!.content, evidenceIds: [records[0]!.evidenceId], tokenCount: 2 })
    await rebuilt.rebuild(records, [])

    const incrementalResult = await incremental.retrieve(lookup)
    const rebuiltResult = await rebuilt.retrieve(lookup)
    const { latencyMs: incrementalLatencyMs, ...incrementalObservable } = incrementalResult
    const { latencyMs: rebuiltLatencyMs, ...rebuiltObservable } = rebuiltResult
    expect(incrementalLatencyMs).toBeGreaterThan(0)
    expect(rebuiltLatencyMs).toBeGreaterThan(0)
    expect(rebuiltObservable).toEqual(incrementalObservable)
  })
})
