// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { evidenceId, iso } from './corpus-fixture-core.js'
import type { CorpusCell } from './corpus-fixture-core.js'
import { selectFixture } from './corpus-fixtures.js'
import { createScaleDistractors as createScaleDistractorsInternal } from './corpus-scale.js'
import type { ScaleDistractorOptions } from './corpus-scale.js'
import { DETERMINISTIC_EMBEDDING_VERSION, MemoryEventSchema, MemoryScenarioSchema } from './types.js'
import type { MemoryEvent, MemoryScenario, SliceLabel } from './types.js'

export const MEMORY_CORPUS_GENERATOR_SEED = 20_260_723
export const MEMORY_CORPUS_GENERATOR_VERSION = 'memory-corpus-v3'

const sliceCycle = [
  'direct-fact',
  'long-range',
  'knowledge-update',
  'temporal-conflict',
  'lexical-exact',
  'semantic-paraphrase',
  'missing-embedding',
  'graph-multi-hop',
  'duplicate-out-of-order',
  'restart-rebuild',
  'erasure-non-recapture',
  'abstention',
  'guest-visibility',
  'cross-scope',
] as const satisfies readonly SliceLabel[]

const cells = [
  { kind: 'personal', language: 'en' },
  { kind: 'personal', language: 'ru' },
  { kind: 'group', language: 'en' },
  { kind: 'group', language: 'ru' },
] as const satisfies readonly CorpusCell[]

const pad = (value: number): string => value.toString().padStart(3, '0')

const makeFaults = (
  label: SliceLabel,
  targetEvidenceId: string,
  queryId: string,
  parsedEvents: readonly MemoryEvent[],
): Record<string, unknown> => ({
  missingEmbeddingEvidenceIds: label === 'missing-embedding' ? [targetEvidenceId] : [],
  embeddingVersionChanges:
    label === 'restart-rebuild'
      ? [
          {
            evidenceId: targetEvidenceId,
            fromVersion: DETERMINISTIC_EMBEDDING_VERSION,
            toVersion: 'papai-deterministic-bilingual-v2',
            changedAt: iso(2, 1, 10),
          },
        ]
      : [],
  duplicateEvidenceIds: label === 'duplicate-out-of-order' ? [targetEvidenceId] : [],
  ingestOrder:
    label === 'duplicate-out-of-order'
      ? [parsedEvents[1]!.eventId, parsedEvents[0]!.eventId, parsedEvents[0]!.eventId]
      : parsedEvents.map(({ eventId: id }) => id),
  restartBeforeQueryIds: label === 'restart-rebuild' ? [queryId] : [],
  recaptureAfterForgetEvidenceIds: label === 'erasure-non-recapture' ? [targetEvidenceId] : [],
  crossScopeProbeQueryIds: label === 'cross-scope' ? [queryId] : [],
  rebuildBeforeQueryIds: label === 'restart-rebuild' ? [queryId] : [],
})

const makeScenario = (cell: CorpusCell, cellIndex: number, index: number): MemoryScenario => {
  const ordinal = index + 1
  const suffix = `${cell.kind}-${cell.language}-${pad(ordinal)}`
  const label = sliceCycle[index % sliceCycle.length] ?? 'direct-fact'
  const scope = {
    kind: cell.kind,
    id: `${cell.kind}-synthetic-${cell.language}-${pad(ordinal)}`,
  } as const
  const queryId = `query-${suffix}-01`
  const fixture = selectFixture(cell, suffix, scope, label)
  const parsedEvents = fixture.events.map((event) => MemoryEventSchema.parse(event))
  const targetEvidenceId = evidenceId(suffix, 'target')
  return MemoryScenarioSchema.parse({
    scenarioId: `scenario-${suffix}`,
    split: index < 15 ? 'development' : 'sealed-test',
    primaryScope: scope,
    language: cell.language,
    labels: [label],
    events: parsedEvents,
    queries: [
      {
        queryId,
        authorizedScope: scope,
        actorRole: fixture.actorRole,
        language: cell.language,
        queryTime: fixture.queryTime,
        k: 8,
        contextTokenBudget: 512,
        expectedEvidenceIds: fixture.expectedEvidenceIds,
        forbiddenEvidenceIds: fixture.forbiddenEvidenceIds,
        erasedEvidenceIds: fixture.erasedEvidenceIds,
        slices: [label],
        text: fixture.queryText,
      },
    ],
    forgetRequests: fixture.forgetRequests,
    faults: makeFaults(label, targetEvidenceId, queryId, parsedEvents),
    seed: MEMORY_CORPUS_GENERATOR_SEED + cellIndex * 60 + index,
  })
}

export const memoryScenarios: readonly MemoryScenario[] = Object.freeze(
  cells.flatMap((cell, cellIndex) => Array.from({ length: 60 }, (_, index) => makeScenario(cell, cellIndex, index))),
)

export type { ScaleDistractorOptions } from './corpus-scale.js'

export const createScaleDistractors = (options: ScaleDistractorOptions): Iterable<MemoryEvent> =>
  createScaleDistractorsInternal(options)
