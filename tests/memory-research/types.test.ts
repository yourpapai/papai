// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import {
  ForgetRequestSchema,
  MemoryEventSchema,
  MemoryHitSchema,
  MemoryQuerySchema,
  MemoryScenarioSchema,
} from '../../scripts/memory-research/types.js'
import type { MemoryScope } from '../../scripts/memory-research/types.js'

const scope = { kind: 'personal', id: 'personal-synthetic-001' } as const
const validity = { validFrom: '2026-01-01T00:00:00.000Z', validTo: null } as const
const scopeKey = (value: MemoryScope): string => `${value.kind}:${value.id}`

describe('memory research contracts', () => {
  test('validates immutable canonical events and rejects unknown fields', () => {
    const event = {
      eventId: 'event-personal-en-001-01',
      evidenceId: 'evidence-personal-en-001-01',
      scope,
      language: 'en',
      eventTime: '2026-01-01T00:00:00.000Z',
      ingestTime: '2026-01-01T00:01:00.000Z',
      content: 'Synthetic user prefers tea.',
      type: 'preference',
      threadId: null,
      entities: [],
      relations: [],
      validity,
      embedding: { available: true, version: 'papai-deterministic-bilingual-v1' },
    }

    expect(MemoryEventSchema.parse(event) as unknown).toEqual(event)
    expect(MemoryEventSchema.safeParse({ ...event, secret: true }).success).toBeFalse()
  })

  test('validates query, hit, scenario, and targeted hard-erasure variants', () => {
    const query = {
      queryId: 'query-personal-en-001-01',
      authorizedScope: scope,
      actorRole: 'owner',
      language: 'en',
      queryTime: '2026-02-01T00:00:00.000Z',
      k: 8,
      contextTokenBudget: 512,
      expectedEvidenceIds: ['evidence-personal-en-001-01'],
      forbiddenEvidenceIds: [],
      erasedEvidenceIds: [],
      slices: ['direct-fact'],
      text: 'What drink does the synthetic user prefer?',
    }
    const hit = {
      evidenceId: 'evidence-personal-en-001-01',
      sourceEventId: 'event-personal-en-001-01',
      scope,
      score: { lexical: 1, dense: 0.8, graph: 0, recency: 0.5, total: 0.9 },
      rank: 1,
      content: 'Synthetic user prefers tea.',
      validity,
      provenance: { kind: 'canonical', derivedFromEvidenceIds: [] },
    }
    const forgetRequests = [
      {
        kind: 'evidence',
        scope,
        evidenceIds: ['evidence-personal-en-001-01'],
        completedAt: '2026-01-15T00:00:00.000Z',
      },
      {
        kind: 'subject',
        scope,
        subjectId: 'entity-synthetic-001',
        completedAt: '2026-01-15T00:00:00.000Z',
      },
      {
        kind: 'scope',
        scope,
        completedAt: '2026-01-15T00:00:00.000Z',
      },
    ] as const

    expect(MemoryQuerySchema.safeParse(query).success).toBeTrue()
    expect(MemoryHitSchema.safeParse(hit).success).toBeTrue()
    expect(forgetRequests.every((request) => ForgetRequestSchema.safeParse(request).success)).toBeTrue()
    expect(
      MemoryScenarioSchema.safeParse({
        scenarioId: 'scenario-personal-en-001',
        split: 'development',
        primaryScope: scope,
        language: 'en',
        labels: ['direct-fact'],
        events: [
          {
            eventId: 'event-personal-en-001-01',
            evidenceId: 'evidence-personal-en-001-01',
            scope,
            language: 'en',
            eventTime: '2026-01-01T00:00:00.000Z',
            ingestTime: '2026-01-01T00:01:00.000Z',
            content: 'Synthetic user prefers tea.',
            type: 'preference',
            threadId: null,
            entities: [
              {
                entityId: 'entity-synthetic-001',
                type: 'synthetic-person',
                name: 'Synthetic Person',
                aliases: [],
              },
            ],
            relations: [],
            validity,
            embedding: { available: true, version: 'papai-deterministic-bilingual-v1' },
          },
        ],
        queries: [query],
        forgetRequests,
        faults: {
          missingEmbeddingEvidenceIds: [],
          embeddingVersionChanges: [],
          duplicateEvidenceIds: [],
          ingestOrder: [],
          restartBeforeQueryIds: [],
          recaptureAfterForgetEvidenceIds: [],
          crossScopeProbeQueryIds: [],
          rebuildBeforeQueryIds: [],
        },
        seed: 20260723,
      }).success,
    ).toBeTrue()
  })

  test('rejects invalid ids, dates, ranks, query depth, and incomplete embedding metadata', () => {
    const otherwiseValidEvent = {
      eventId: 'event-personal-en-invalid-01',
      evidenceId: 'evidence-personal-en-invalid-01',
      scope,
      language: 'en',
      eventTime: '2026-01-01T00:00:00.000Z',
      ingestTime: '2026-01-01T00:01:00.000Z',
      content: 'Synthetic user prefers tea.',
      type: 'preference',
      threadId: null,
      entities: [],
      relations: [],
      validity,
      embedding: { available: true, version: null },
    }

    expect(MemoryQuerySchema.safeParse({}).success).toBeFalse()
    expect(MemoryEventSchema.safeParse({ eventId: '' }).success).toBeFalse()
    expect(MemoryHitSchema.safeParse({ rank: 0 }).success).toBeFalse()
    expect(MemoryEventSchema.safeParse(otherwiseValidEvent).success).toBeFalse()
  })

  test('bounds candidate hit content and provenance payloads', () => {
    const hit = {
      evidenceId: 'evidence-bounded-hit',
      sourceEventId: 'event-bounded-hit',
      scope,
      score: { lexical: 1, dense: 0, graph: 0, recency: 0, total: 1 },
      rank: 1,
      content: 'bounded',
      validity,
      provenance: { kind: 'derived', derivedFromEvidenceIds: ['evidence-bounded-source'] },
    }

    expect(
      MemoryHitSchema.safeParse({
        ...hit,
        provenance: {
          kind: 'derived',
          derivedFromEvidenceIds: Array.from({ length: 65 }, (_, index) => `evidence-bounded-source-${index}`),
        },
      }).success,
    ).toBeFalse()
    expect(MemoryHitSchema.safeParse({ ...hit, content: 'x'.repeat(16_385) }).success).toBeFalse()
  })

  test('requires authorized scope on evidence and subject hard erasure', () => {
    expect(
      ForgetRequestSchema.safeParse({
        kind: 'evidence',
        evidenceIds: ['evidence-personal-en-001-01'],
        completedAt: '2026-01-15T00:00:00.000Z',
      }).success,
    ).toBeFalse()
    expect(
      ForgetRequestSchema.safeParse({
        kind: 'subject',
        subjectId: 'entity-synthetic-001',
        completedAt: '2026-01-15T00:00:00.000Z',
      }).success,
    ).toBeFalse()
  })

  test('rejects broken scenario references and local identity collisions', () => {
    const base = memoryScenarios.find(({ events }) => events.length >= 2)!
    const graph = memoryScenarios.find(({ labels }) => labels.includes('graph-multi-hop'))!
    const crossScope = memoryScenarios.find(({ labels }) => labels.includes('cross-scope'))!
    const longRange = memoryScenarios.find(({ labels }) => labels.includes('long-range'))!
    const firstEvent = base.events[0]!
    const secondEvent = base.events[1]!
    const firstQuery = base.queries[0]!
    const graphEventIndex = graph.events.findIndex(({ relations }) => relations.length > 0)
    const graphEvent = graph.events[graphEventIndex]!
    const firstRelation = graphEvent.relations[0]!
    const foreignEvent = crossScope.events.find(
      ({ scope: eventScope }) => scopeKey(eventScope) !== scopeKey(crossScope.primaryScope),
    )!
    const lastLongRangeEvent = longRange.events.at(-1)!
    const invalidLongRangeEvents = [
      ...longRange.events.slice(0, -1),
      { ...lastLongRangeEvent, evidenceId: longRange.events[0]!.evidenceId },
    ]
    const invalidGraphEvent = {
      ...graphEvent,
      relations: [
        {
          ...firstRelation,
          targetEntityId: 'entity-does-not-exist',
        },
        ...graphEvent.relations.slice(1),
      ],
    }
    const invalidGraphEvents = [
      ...graph.events.slice(0, graphEventIndex),
      invalidGraphEvent,
      ...graph.events.slice(graphEventIndex + 1),
    ]
    const invalidScenarios = [
      {
        ...base,
        events: [firstEvent, { ...secondEvent, evidenceId: firstEvent.evidenceId }, ...base.events.slice(2)],
      },
      {
        ...longRange,
        events: invalidLongRangeEvents,
      },
      {
        ...base,
        queries: [
          {
            ...firstQuery,
            expectedEvidenceIds: ['evidence-does-not-exist'],
          },
        ],
      },
      {
        ...base,
        faults: {
          ...base.faults,
          ingestOrder: ['event-does-not-exist'],
        },
      },
      {
        ...base,
        queries: [
          {
            ...firstQuery,
            authorizedScope: { kind: 'group', id: 'group-wrong-scope' },
          },
        ],
      },
      {
        ...graph,
        events: invalidGraphEvents,
      },
      {
        ...crossScope,
        forgetRequests: [
          {
            kind: 'evidence',
            scope: crossScope.primaryScope,
            evidenceIds: [foreignEvent.evidenceId],
            completedAt: '2026-03-01T00:00:00.000Z',
          },
        ],
      },
    ]

    expect(invalidScenarios.every((scenario) => !MemoryScenarioSchema.safeParse(scenario).success)).toBeTrue()
  })
})
