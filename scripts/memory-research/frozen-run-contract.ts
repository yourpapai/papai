// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { memoryScenarios } from './corpus.js'
import type { LifecycleEntry } from './report-schema.js'
import type { MemoryEvent, MemoryScenario, RunManifest } from './types.js'

export const FROZEN_SYNTHETIC_SUITE = 'papai-synthetic-v3'

const scenarioById = new Map(memoryScenarios.map((scenario) => [scenario.scenarioId, scenario] as const))

export const frozenScenario = (scenarioId: MemoryScenario['scenarioId']): MemoryScenario | undefined =>
  scenarioById.get(scenarioId)

export const frozenSplitScenarioIds = (split: MemoryScenario['split']): readonly string[] => {
  const ids = memoryScenarios.filter((scenario) => scenario.split === split).map(({ scenarioId }) => scenarioId)
  return [...ids].sort((left, right) => left.localeCompare(right))
}

export const combineScenarioFaultSchedule = (
  scenarios: readonly MemoryScenario[],
): RunManifest['faultConfiguration'] => ({
  missingEmbeddingEvidenceIds: scenarios.flatMap(({ faults }) => faults.missingEmbeddingEvidenceIds),
  embeddingVersionChanges: scenarios.flatMap(({ faults }) => faults.embeddingVersionChanges),
  duplicateEvidenceIds: scenarios.flatMap(({ faults }) => faults.duplicateEvidenceIds),
  ingestOrder: scenarios.flatMap(({ faults }) => faults.ingestOrder),
  forgetRequests: scenarios.flatMap(({ forgetRequests }) => forgetRequests),
  nonRecaptureEvidenceIds: scenarios.flatMap(({ faults }) => faults.recaptureAfterForgetEvidenceIds),
  crossScopeProbeQueryIds: scenarios.flatMap(({ faults }) => faults.crossScopeProbeQueryIds),
  restartBeforeQueryIds: scenarios.flatMap(({ faults }) => faults.restartBeforeQueryIds),
  rebuildBeforeQueryIds: scenarios.flatMap(({ faults }) => faults.rebuildBeforeQueryIds),
})

export type ExpectedLifecycleStep = Readonly<{
  kind: LifecycleEntry['kind']
  referenceId: string
}>

const scopeKey = ({ kind, id }: MemoryEvent['scope']): string => `${kind}:${id}`

const expectedScaleSteps = (scenario: MemoryScenario, scale: RunManifest['scale']): readonly ExpectedLifecycleStep[] =>
  [...new Set(scenario.events.map(({ scope }) => scopeKey(scope)))]
    .sort((left, right) => left.localeCompare(right))
    .map((scope) => ({ kind: 'scale-ingest', referenceId: `${scope}:${scale}` }))

const eventForEvidence = (scenario: MemoryScenario, evidenceId: string): MemoryEvent | undefined =>
  scenario.events.find((event) => event.evidenceId === evidenceId)

const forgetCoversEvent = (request: MemoryScenario['forgetRequests'][number], event: MemoryEvent): boolean => {
  if (scopeKey(request.scope) !== scopeKey(event.scope)) return false
  if (request.kind === 'scope') return true
  if (request.kind === 'evidence') return request.evidenceIds.includes(event.evidenceId)
  return event.entities.some(({ entityId }) => entityId === request.subjectId)
}

const expectedForgetSteps = (scenario: MemoryScenario): readonly ExpectedLifecycleStep[] => {
  const requests = [...scenario.forgetRequests].sort(
    (left, right) => left.completedAt.localeCompare(right.completedAt) || left.kind.localeCompare(right.kind),
  )
  return requests.reduce<Readonly<{ recaptured: ReadonlySet<string>; steps: readonly ExpectedLifecycleStep[] }>>(
    (state, request) => {
      const recaptures = scenario.faults.recaptureAfterForgetEvidenceIds
        .filter((evidenceId) => !state.recaptured.has(evidenceId))
        .filter((evidenceId) => {
          const event = eventForEvidence(scenario, evidenceId)
          return event !== undefined && forgetCoversEvent(request, event)
        })
      return {
        recaptured: new Set([...state.recaptured, ...recaptures]),
        steps: [
          ...state.steps,
          { kind: 'forget', referenceId: `${request.kind}:${request.scope.id}` },
          ...recaptures.map((referenceId) => ({ kind: 'recapture-attempt' as const, referenceId })),
        ],
      }
    },
    { recaptured: new Set<string>(), steps: [] },
  ).steps
}

const expectedQuerySteps = (scenario: MemoryScenario): readonly ExpectedLifecycleStep[] =>
  scenario.queries.flatMap((query) => {
    if (scenario.faults.rebuildBeforeQueryIds.includes(query.queryId)) {
      return [
        { kind: 'restart' as const, referenceId: query.queryId },
        { kind: 'rebuild' as const, referenceId: query.queryId },
        { kind: 'query' as const, referenceId: query.queryId },
      ]
    }
    return [
      ...(scenario.faults.restartBeforeQueryIds.includes(query.queryId)
        ? [{ kind: 'restart' as const, referenceId: query.queryId }]
        : []),
      { kind: 'query' as const, referenceId: query.queryId },
    ]
  })

export const expectedLifecycleSteps = (
  scenario: MemoryScenario,
  scale: RunManifest['scale'],
): readonly ExpectedLifecycleStep[] => [
  ...expectedScaleSteps(scenario, scale),
  ...scenario.faults.ingestOrder.map((referenceId) => ({ kind: 'event-ingest' as const, referenceId })),
  ...[...scenario.faults.embeddingVersionChanges]
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt))
    .map(({ evidenceId: referenceId }) => ({ kind: 'embedding-version-change' as const, referenceId })),
  ...expectedForgetSteps(scenario),
  ...expectedQuerySteps(scenario),
]
