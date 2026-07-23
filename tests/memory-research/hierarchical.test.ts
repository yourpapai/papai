// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createCorrectedHybridCandidate } from '../../scripts/memory-research/candidates/corrected-hybrid.js'
import { createHierarchicalCandidate } from '../../scripts/memory-research/candidates/hierarchical.js'
import { createScaleDistractors } from '../../scripts/memory-research/corpus.js'
import {
  DETERMINISTIC_EMBEDDING_VERSION,
  MemoryEventSchema,
  MemoryQuerySchema,
} from '../../scripts/memory-research/types.js'
import type {
  MemoryEntity,
  MemoryEvent,
  MemoryHit,
  MemoryQuery,
  MemoryScope,
  ResourceMetrics,
} from '../../scripts/memory-research/types.js'

const scope = { kind: 'personal', id: 'personal-hierarchy' } as const satisfies MemoryScope
const topic: MemoryEntity = {
  entityId: 'topic-aurora',
  type: 'project',
  name: 'Aurora',
  aliases: ['Project Aurora'],
}
const timestamp = (day: number, hour = 12): string => new Date(Date.UTC(2026, 6, day, hour)).toISOString()

const event = (
  suffix: string,
  content: string,
  day: number,
  options: Readonly<{
    available?: boolean
    entity?: MemoryEntity
    eventScope?: MemoryScope
    threadId?: string | null
    validTo?: string | null
  }> = {},
): MemoryEvent =>
  MemoryEventSchema.parse({
    eventId: `event-${suffix}`,
    evidenceId: `evidence-${suffix}`,
    scope: options.eventScope ?? scope,
    language: 'en',
    eventTime: timestamp(day),
    ingestTime: timestamp(day),
    content,
    type: 'fact',
    threadId: options.threadId ?? 'thread-aurora',
    entities: options.entity === undefined ? [] : [options.entity],
    relations: [],
    validity: { validFrom: timestamp(day), validTo: options.validTo ?? null },
    embedding: {
      available: options.available ?? true,
      version: options.available === false ? null : DETERMINISTIC_EMBEDDING_VERSION,
    },
  })

const query = (
  suffix: string,
  text: string,
  options: Readonly<{
    actorRole?: 'owner' | 'member' | 'guest'
    budget?: number
    queryScope?: MemoryScope
    queryTime?: string
  }> = {},
): MemoryQuery =>
  MemoryQuerySchema.parse({
    queryId: `query-${suffix}`,
    authorizedScope: options.queryScope ?? scope,
    actorRole: options.actorRole ?? 'owner',
    language: 'en',
    queryTime: options.queryTime ?? timestamp(30),
    k: 8,
    contextTokenBudget: options.budget ?? 256,
    expectedEvidenceIds: [],
    forbiddenEvidenceIds: [],
    erasedEvidenceIds: [],
    slices: ['long-range'],
    text,
  })

const successfulHits = async (
  candidate: ReturnType<typeof createHierarchicalCandidate>,
  lookup: MemoryQuery,
): Promise<readonly MemoryHit[]> => {
  const result = await candidate.retrieve(lookup)
  expect(result.status).toBe('success')
  return result.status === 'success' ? result.hits : []
}

const provenanceContent = (index: number): string =>
  index === 69 ? 'The TARGET-PROVENANCE release is Tuesday.' : `Aurora archive note ${index}.`

describe('hierarchical event and fact memory candidate', () => {
  test('samples RSS before leaf and hierarchy report-only serialization', async () => {
    const calls: string[] = []
    const leaf = createCorrectedHybridCandidate()
    const candidate = createHierarchicalCandidate({
      createLeafCandidate: () => ({
        ...leaf,
        resourceMetrics: (): Promise<ResourceMetrics> => {
          calls.push('leaf')
          return leaf.resourceMetrics()
        },
      }),
      readRssBytes: () => {
        calls.push('rss')
        return 125
      },
      measureHierarchyStateBytes: () => {
        calls.push('hierarchy')
        return 0
      },
    })

    await candidate.resourceMetrics()

    expect(calls).toEqual(['rss', 'leaf', 'hierarchy'])
  })

  test('uses a long-running topic summary to surface canonical leaf evidence with explicit provenance', async () => {
    const identity = event('topic-identity', 'Aurora is the confidential codename.', 1, { entity: topic })
    const schedule = event('topic-schedule', 'The launch window moved to Tuesday.', 20, { entity: topic })
    const candidate = createHierarchicalCandidate()
    await candidate.ingest([identity, schedule])

    const hits = await successfulHits(candidate, query('topic', 'When is the Aurora launch window?'))
    const scheduleHit = hits.find(({ evidenceId }) => evidenceId === schedule.evidenceId)

    expect(scheduleHit).toBeDefined()
    expect(scheduleHit).toMatchObject({
      sourceEventId: schedule.eventId,
      content: schedule.content,
      provenance: { kind: 'derived' },
    })
    expect(scheduleHit!.provenance.derivedFromEvidenceIds).toContain(identity.evidenceId)
    expect(scheduleHit!.provenance.derivedFromEvidenceIds).toContain(schedule.evidenceId)
  })

  test('always names the returned canonical leaf when bounded derived provenance has many members', async () => {
    const records = Array.from({ length: 70 }, (_, index) =>
      event(`provenance-${index.toString().padStart(2, '0')}`, provenanceContent(index), (index % 28) + 1, {
        entity: topic,
      }),
    )
    const target = records[69]!
    const candidate = createHierarchicalCandidate()
    await candidate.ingest(records)

    const hits = await successfulHits(candidate, query('provenance', 'When is TARGET-PROVENANCE released?'))
    const targetHit = hits.find(({ evidenceId }) => evidenceId === target.evidenceId)

    expect(targetHit).toBeDefined()
    expect(targetHit!.provenance.kind).toBe('derived')
    expect(targetHit!.provenance.derivedFromEvidenceIds).toContain(target.evidenceId)
  })

  test('assembles canonical leaves first, then useful session and topic summaries with leaf citations', async () => {
    const identity = event('context-identity', 'Aurora is the confidential codename.', 1, { entity: topic })
    const schedule = event('context-schedule', 'The launch window moved to Tuesday.', 20, { entity: topic })
    const candidate = createHierarchicalCandidate()
    const lookup = query('context', 'When is the Aurora launch window?', { budget: 96 })
    await candidate.ingest([identity, schedule])
    const hits = await successfulHits(candidate, lookup)
    const scheduleHit = hits.find(({ evidenceId }) => evidenceId === schedule.evidenceId)!

    const context = await candidate.assembleContext(lookup, [scheduleHit])

    expect(context.tokenCount).toBeLessThanOrEqual(lookup.contextTokenBudget)
    expect(context.evidenceIds).toEqual([schedule.evidenceId, identity.evidenceId])
    expect(context.text).toContain(schedule.content)
    expect(context.text).toContain(identity.content)
    expect(context.text).toContain('Session summary')
    expect(context.text).toContain('Topic summary')
    expect(context.text).toContain(`[evidence:${schedule.evidenceId}]`)
    expect(context.text).toContain(`[evidence:${identity.evidenceId}]`)
    expect(context.text.indexOf(schedule.content)).toBeLessThan(context.text.indexOf(identity.content))
    expect(context.text.indexOf(identity.content)).toBeLessThan(context.text.indexOf('Session summary'))
  })

  test('does not admit supporting evidence when its explicit citation would exceed the budget', async () => {
    const identity = event('atomic-identity', 'Aurora is the confidential codename.', 1, { entity: topic })
    const schedule = event('atomic-schedule', 'The launch window moved to Tuesday.', 20, { entity: topic })
    const candidate = createHierarchicalCandidate()
    const lookup = query('atomic-context', 'When is the Aurora launch window?', { budget: 11 })
    await candidate.ingest([identity, schedule])
    const hits = await successfulHits(candidate, lookup)
    const scheduleHit = hits.find(({ evidenceId }) => evidenceId === schedule.evidenceId)!

    const context = await candidate.assembleContext(lookup, [scheduleHit])

    expect(context.tokenCount).toBeLessThanOrEqual(lookup.contextTokenBudget)
    expect(context.evidenceIds).toEqual([schedule.evidenceId])
    expect(context.text).toBe(schedule.content)
    expect(context.text).not.toContain(identity.content)
    expect(context.text).not.toContain(`[evidence:${identity.evidenceId}]`)
  })

  test('preserves contradictory history while filtering leaves and derivatives by half-open validity', async () => {
    const transition = timestamp(15)
    const prior = event('validity-prior', 'POLAR-55 launches on Monday.', 1, {
      entity: topic,
      validTo: transition,
    })
    const current = event('validity-current', 'POLAR-55 launches on Tuesday.', 15, { entity: topic })
    const candidate = createHierarchicalCandidate()
    await candidate.ingest([prior, current])

    const before = await successfulHits(
      candidate,
      query('validity-before', 'When does POLAR-55 launch?', { queryTime: timestamp(10) }),
    )
    const after = await successfulHits(
      candidate,
      query('validity-after', 'When does POLAR-55 launch?', { queryTime: timestamp(20) }),
    )

    expect(before.map(({ evidenceId }) => evidenceId)).toContain(prior.evidenceId)
    expect(before.map(({ evidenceId }) => evidenceId)).not.toContain(current.evidenceId)
    expect(after.map(({ evidenceId }) => evidenceId)).toContain(current.evidenceId)
    expect(after.map(({ evidenceId }) => evidenceId)).not.toContain(prior.evidenceId)
  })

  test('does not let expired derivative tokens surface an unrelated live leaf', async () => {
    const expired = event('expired-token', 'OLDCODE SECRETCODE was retired.', 1, {
      available: false,
      entity: topic,
      validTo: timestamp(15),
    })
    const unrelatedLive = event('expired-token-live', 'Garden watering checklist.', 15, {
      available: false,
      entity: topic,
    })
    const lookup = query('expired-token', 'Where is OLDCODE SECRETCODE?', { queryTime: timestamp(20) })
    const corrected = createCorrectedHybridCandidate()
    const hierarchy = createHierarchicalCandidate()
    await corrected.ingest([expired, unrelatedLive])
    await hierarchy.ingest([expired, unrelatedLive])

    expect(await successfulHits(corrected, lookup)).toEqual([])
    expect(await successfulHits(hierarchy, lookup)).toEqual([])
  })

  test('cascades scoped hard erasure through summaries and blocks recapture', async () => {
    const erased = event('cascade-erased', 'Aurora launch owner is Dana.', 1, { entity: topic })
    const kept = event('cascade-kept', 'Aurora launch window is Tuesday.', 2, { entity: topic })
    const keptDetail = event('cascade-kept-detail', 'Aurora launch review is complete.', 3, { entity: topic })
    const candidate = createHierarchicalCandidate()
    const lookup = query('cascade', 'What is the Aurora launch window?')
    await candidate.ingest([erased, kept, keptDetail])
    await candidate.forget({
      kind: 'evidence',
      scope,
      evidenceIds: [erased.evidenceId],
      completedAt: timestamp(4),
    })
    await candidate.ingest([erased])

    const hits = await successfulHits(candidate, lookup)
    const context = await candidate.assembleContext(lookup, hits)

    expect(hits.map(({ evidenceId }) => evidenceId)).not.toContain(erased.evidenceId)
    expect(context.text).not.toContain(erased.content)
    expect(context.text).not.toContain(`[evidence:${erased.evidenceId}]`)
    expect(context.text).toContain(`[evidence:${kept.evidenceId}]`)
  })

  test('rebuild reconstructs identical ordered leaves, provenance, and assembled hierarchy', async () => {
    const removed = event('rebuild-removed', 'Aurora launch owner is Dana.', 1, { entity: topic })
    const kept = event('rebuild-kept', 'Aurora launch window is Tuesday.', 2, { entity: topic })
    const request = {
      kind: 'evidence' as const,
      scope,
      evidenceIds: [removed.evidenceId],
      completedAt: timestamp(3),
    }
    const lookup = query('rebuild', 'What is the Aurora launch window?')
    const incremental = createHierarchicalCandidate()
    const rebuilt = createHierarchicalCandidate()
    await incremental.ingest([removed, kept])
    await incremental.forget(request)
    await rebuilt.rebuild([removed, kept], [request])

    const incrementalHits = await successfulHits(incremental, lookup)
    const rebuiltHits = await successfulHits(rebuilt, lookup)
    expect(rebuiltHits).toEqual(incrementalHits)
    expect(await rebuilt.assembleContext(lookup, rebuiltHits)).toEqual(
      await incremental.assembleContext(lookup, incrementalHits),
    )
  })

  test('keeps missing embeddings lexically retrievable and accounts for vectors and derived storage', async () => {
    const unavailable = event('resource-unavailable', 'The rare HIER-731 launch marker is valid.', 1, {
      available: false,
      entity: topic,
    })
    const available = event('resource-available', 'The rare HIER-731 launch marker is valid.', 1, {
      entity: topic,
    })
    const withoutVector = createHierarchicalCandidate()
    const withVector = createHierarchicalCandidate()
    await withoutVector.ingest([unavailable])
    await withVector.ingest([available])

    expect(
      (await successfulHits(withoutVector, query('resource', 'What is HIER-731?'))).map(({ evidenceId }) => evidenceId),
    ).toContain(unavailable.evidenceId)
    expect((await withoutVector.resourceMetrics()).storedBytes).toBeGreaterThan(
      new TextEncoder().encode(JSON.stringify(unavailable)).byteLength,
    )
    expect((await withVector.resourceMetrics()).storedBytes).toBeGreaterThan(
      (await withoutVector.resourceMetrics()).storedBytes,
    )
  })

  test('handles the frozen 100k scale path with finite resources and bounded context', async () => {
    const candidate = createHierarchicalCandidate()
    const distractors = [
      ...createScaleDistractors({
        scale: 100_000,
        scope,
        language: 'en',
        seed: 73,
      }),
    ]
    const target = event('scale-target', 'The unique HIER-SCALE-991 release is Tuesday.', 29, {
      available: false,
      entity: topic,
    })
    await candidate.ingest([...distractors, target])

    const lookup = query('scale', 'When is HIER-SCALE-991 released?', { budget: 32 })
    const hits = await successfulHits(candidate, lookup)
    const context = await candidate.assembleContext(lookup, hits)
    const metrics = await candidate.resourceMetrics()

    expect(hits.map(({ evidenceId }) => evidenceId)).toContain(target.evidenceId)
    expect(context.tokenCount).toBeLessThanOrEqual(lookup.contextTokenBudget)
    expect(Object.values(metrics).every((value) => Number.isFinite(value))).toBeTrue()
  }, 30_000)
})
