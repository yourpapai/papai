// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createAsShippedCandidate } from '../../scripts/memory-research/candidates/as-shipped.js'
import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import { MemoryEventSchema, MemoryQuerySchema } from '../../scripts/memory-research/types.js'
import type {
  MemoryEvent,
  MemoryQuery,
  MemoryScenario,
  MemoryScope,
  RawQueryResult,
} from '../../scripts/memory-research/types.js'

const personalScope = { kind: 'personal', id: 'personal-as-shipped' } as const satisfies MemoryScope
const groupScope = { kind: 'group', id: 'group-as-shipped' } as const satisfies MemoryScope
const timestamp = (hour: number): string => `2026-07-23T${hour.toString().padStart(2, '0')}:00:00.000Z`

const event = (
  suffix: string,
  scope: MemoryScope,
  content: string,
  hour: number,
  options: Readonly<{ available?: boolean; validTo?: string | null }> = {},
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
    entities: [],
    relations: [],
    validity: { validFrom: timestamp(hour), validTo: options.validTo ?? null },
    embedding: { available: options.available ?? true, version: options.available === false ? null : 'test-v1' },
  })

const query = (
  suffix: string,
  scope: MemoryScope,
  text: string,
  options: Readonly<{ actorRole?: 'owner' | 'member' | 'guest'; budget?: number }> = {},
): MemoryQuery =>
  MemoryQuerySchema.parse({
    queryId: `query-${suffix}`,
    authorizedScope: scope,
    actorRole: options.actorRole ?? 'owner',
    language: 'en',
    queryTime: timestamp(23),
    k: 8,
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

describe('as-shipped memory candidate', () => {
  test('lets an embedded semantic hit suppress a missing-vector rare identifier', async () => {
    const scenario = missingEmbeddingScenario()
    const candidate = createAsShippedCandidate()
    await candidate.ingest(scenario.events)

    const result = successfulResult(await candidate.retrieve(scenario.queries[0]!))

    expect(result.hits.map(({ evidenceId }) => evidenceId)).toEqual([scenario.events[1]!.evidenceId])
    expect(result.hits.map(({ evidenceId }) => evidenceId)).not.toContain(scenario.events[0]!.evidenceId)
    expect(result.hits[0]!.score.dense).toBeGreaterThanOrEqual(0.65)
  })

  test('fails to retrieve Cyrillic-only lexical evidence when no vector exists', async () => {
    const candidate = createAsShippedCandidate()
    const russianScope = { kind: 'personal', id: 'personal-russian-as-shipped' } as const
    const russianEvent = MemoryEventSchema.parse({
      ...event('russian', russianScope, 'Секретный маркер РУБИН подтвержден.', 10, { available: false }),
      language: 'ru',
    })
    const russianQuery = MemoryQuerySchema.parse({
      ...query('russian', russianScope, 'Где подтвержден секретный маркер РУБИН?'),
      language: 'ru',
    })
    await candidate.ingest([russianEvent])

    const result = await candidate.retrieve(russianQuery)

    expect(result).toMatchObject({ status: 'success', hits: [] })
  })

  test('retrieves an expired record while it remains active', async () => {
    const candidate = createAsShippedCandidate()
    const expired = event('expired', personalScope, 'The ORBIT-77 deployment is approved.', 10, {
      available: false,
      validTo: timestamp(11),
    })
    await candidate.ingest([expired])

    const result = await candidate.retrieve(query('expired', personalScope, 'What is ORBIT-77?'))

    expect(result).toMatchObject({ status: 'success', hits: [{ evidenceId: expired.evidenceId }] })
  })

  test('assembles the three most recent active records rather than query hits', async () => {
    const candidate = createAsShippedCandidate()
    const records = [
      event('recency-one', personalScope, 'old', 1, { available: false }),
      event('recency-two', personalScope, 'second', 2, { available: false }),
      event('recency-three', personalScope, 'third', 3, { available: false }),
      event('recency-four', personalScope, 'newest', 4, { available: false }),
    ]
    await candidate.ingest(records)

    const context = await candidate.assembleContext(query('recency', personalScope, 'unrelated'), [])

    expect(context.evidenceIds).toEqual([records[3]!.evidenceId, records[2]!.evidenceId, records[1]!.evidenceId])
    expect(context.text).not.toContain(records[0]!.content)
  })

  test('allows a guest to read group memory', async () => {
    const candidate = createAsShippedCandidate()
    const groupEvent = event('guest-visible', groupScope, 'The group secret is VIOLET-92.', 10, { available: false })
    await candidate.ingest([groupEvent])

    const result = await candidate.retrieve(
      query('guest-visible', groupScope, 'What is VIOLET-92?', { actorRole: 'guest' }),
    )

    expect(result).toMatchObject({ status: 'success', hits: [{ evidenceId: groupEvent.evidenceId }] })
  })

  test('archives forget targets but permits their later re-ingest', async () => {
    const candidate = createAsShippedCandidate()
    const recaptured = event('recaptured', personalScope, 'The RECAP-19 rule remains.', 10, { available: false })
    const recall = query('recaptured', personalScope, 'What is RECAP-19?')
    await candidate.ingest([recaptured])
    await candidate.forget({
      kind: 'evidence',
      scope: personalScope,
      evidenceIds: [recaptured.evidenceId],
      completedAt: timestamp(12),
    })

    expect(await candidate.retrieve(recall)).toMatchObject({ status: 'success', hits: [] })
    await candidate.ingest([recaptured])

    expect(await candidate.retrieve(recall)).toMatchObject({
      status: 'success',
      hits: [{ evidenceId: recaptured.evidenceId }],
    })
  })

  test('limits ASCII fallback scanning to the 500 most recent active records', async () => {
    const candidate = createAsShippedCandidate()
    const olderTarget = event('fallback-target', personalScope, 'The hidden FALLBACK-501 fact.', 1, {
      available: false,
    })
    const newerDistractors = Array.from({ length: 500 }, (_, index) =>
      event(`fallback-${index}`, personalScope, `Recent distractor ${index}.`, (index % 20) + 2, { available: false }),
    )
    await candidate.ingest([olderTarget, ...newerDistractors])

    const result = await candidate.retrieve(query('fallback-cap', personalScope, 'What is FALLBACK-501?'))

    expect(result).toMatchObject({ status: 'success', hits: [] })
  })

  test('does not charge vector storage for unavailable embeddings', async () => {
    const candidate = createAsShippedCandidate()
    const unavailable = event('storage-none', personalScope, 'Unavailable storage record.', 10, { available: false })
    await candidate.ingest([unavailable])
    expect((await candidate.resourceMetrics()).storedBytes).toBe(
      new TextEncoder().encode(JSON.stringify(unavailable)).byteLength,
    )
  })
})
