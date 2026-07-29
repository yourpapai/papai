// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  ForgetRequestSchema,
  LanguageSchema,
  MemoryEventSchema,
  MemoryQuerySchema,
  MemoryScopeSchema,
  ScenarioFaultsSchema,
  ScenarioIdSchema,
  ScenarioSplitSchema,
  SliceLabelSchema,
} from './types-core.js'
import type { ForgetRequest, MemoryQuery, MemoryScope } from './types-core.js'

const memoryScenarioBaseSchema = z
  .object({
    scenarioId: ScenarioIdSchema,
    split: ScenarioSplitSchema,
    primaryScope: MemoryScopeSchema,
    language: LanguageSchema,
    labels: z.array(SliceLabelSchema).min(1).readonly(),
    events: z.array(MemoryEventSchema).min(1).readonly(),
    queries: z.array(MemoryQuerySchema).min(1).readonly(),
    forgetRequests: z.array(ForgetRequestSchema).readonly(),
    faults: ScenarioFaultsSchema,
    seed: z.number().int().nonnegative(),
  })
  .strict()

type MemoryScenarioValue = z.infer<typeof memoryScenarioBaseSchema>
type EntityScope = Readonly<{ entityId: string; scope: MemoryScope }>

type ScenarioReferences = Readonly<{
  evidenceIds: ReadonlySet<string>
  eventIds: ReadonlySet<string>
  queryIds: ReadonlySet<string>
  entityScopes: readonly EntityScope[]
}>

const sameMemoryScope = (left: MemoryScope, right: MemoryScope): boolean =>
  left.kind === right.kind && left.id === right.id

const addReferenceIssue = (context: z.RefinementCtx, path: readonly PropertyKey[], message: string): void => {
  context.addIssue({ code: 'custom', path: [...path], message })
}

const duplicateValues = (values: readonly string[]): readonly string[] => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
]

const createReferences = (scenario: MemoryScenarioValue): ScenarioReferences => ({
  evidenceIds: new Set(scenario.events.map(({ evidenceId }) => evidenceId)),
  eventIds: new Set(scenario.events.map(({ eventId }) => eventId)),
  queryIds: new Set(scenario.queries.map(({ queryId }) => queryId)),
  entityScopes: scenario.events.flatMap((event) =>
    event.entities.map(({ entityId }) => ({ entityId, scope: event.scope })),
  ),
})

const validateLocalIds = (scenario: MemoryScenarioValue, context: z.RefinementCtx): void => {
  const eventIds = scenario.events.map(({ eventId }) => eventId)
  const evidenceIds = scenario.events.map(({ evidenceId }) => evidenceId)
  const queryIds = scenario.queries.map(({ queryId }) => queryId)
  const allLocalIds = [scenario.scenarioId, ...eventIds, ...evidenceIds, ...queryIds]
  for (const id of duplicateValues(allLocalIds)) {
    addReferenceIssue(context, [], `duplicate local id: ${id}`)
  }
}

const validateEvents = (scenario: MemoryScenarioValue, context: z.RefinementCtx): void => {
  scenario.events.forEach((event, eventIndex) => {
    if (event.language !== scenario.language) {
      addReferenceIssue(context, ['events', eventIndex, 'language'], 'event language mismatch')
    }
    const entityIds = new Set(event.entities.map(({ entityId }) => entityId))
    event.relations.forEach((relation, relationIndex) => {
      if (!entityIds.has(relation.sourceEntityId) || !entityIds.has(relation.targetEntityId)) {
        addReferenceIssue(
          context,
          ['events', eventIndex, 'relations', relationIndex],
          'relation endpoint is absent from event entities',
        )
      }
    })
  })
}

const validateQueryReferences = (
  query: MemoryQuery,
  queryIndex: number,
  scenario: MemoryScenarioValue,
  references: ScenarioReferences,
  context: z.RefinementCtx,
): void => {
  const evidenceReferences = [...query.expectedEvidenceIds, ...query.forbiddenEvidenceIds, ...query.erasedEvidenceIds]
  for (const evidenceId of evidenceReferences) {
    if (!references.evidenceIds.has(evidenceId)) {
      addReferenceIssue(context, ['queries', queryIndex], `unknown query evidence reference: ${evidenceId}`)
    }
  }
  for (const slice of query.slices) {
    if (!scenario.labels.includes(slice)) {
      addReferenceIssue(
        context,
        ['queries', queryIndex, 'slices'],
        `query slice is absent from scenario labels: ${slice}`,
      )
    }
  }
}

const validateQueries = (
  scenario: MemoryScenarioValue,
  references: ScenarioReferences,
  context: z.RefinementCtx,
): void => {
  scenario.queries.forEach((query, queryIndex) => {
    if (query.language !== scenario.language) {
      addReferenceIssue(context, ['queries', queryIndex, 'language'], 'query language mismatch')
    }
    if (!sameMemoryScope(query.authorizedScope, scenario.primaryScope)) {
      addReferenceIssue(
        context,
        ['queries', queryIndex, 'authorizedScope'],
        'query scope must equal primary scenario scope',
      )
    }
    validateQueryReferences(query, queryIndex, scenario, references, context)
  })
}

const validateFaults = (
  scenario: MemoryScenarioValue,
  references: ScenarioReferences,
  context: z.RefinementCtx,
): void => {
  const evidenceReferences = [
    ...scenario.faults.missingEmbeddingEvidenceIds,
    ...scenario.faults.duplicateEvidenceIds,
    ...scenario.faults.recaptureAfterForgetEvidenceIds,
    ...scenario.faults.embeddingVersionChanges.map(({ evidenceId }) => evidenceId),
  ]
  for (const evidenceId of evidenceReferences) {
    if (!references.evidenceIds.has(evidenceId)) {
      addReferenceIssue(context, ['faults'], `unknown fault evidence reference: ${evidenceId}`)
    }
  }
  for (const eventId of scenario.faults.ingestOrder) {
    if (!references.eventIds.has(eventId)) {
      addReferenceIssue(context, ['faults', 'ingestOrder'], `unknown event reference: ${eventId}`)
    }
  }
  const queryReferences = [
    ...scenario.faults.restartBeforeQueryIds,
    ...scenario.faults.crossScopeProbeQueryIds,
    ...scenario.faults.rebuildBeforeQueryIds,
  ]
  for (const queryId of queryReferences) {
    if (!references.queryIds.has(queryId)) {
      addReferenceIssue(context, ['faults'], `unknown fault query reference: ${queryId}`)
    }
  }
}

const validateEvidenceForget = (
  request: Extract<ForgetRequest, { kind: 'evidence' }>,
  requestIndex: number,
  scenario: MemoryScenarioValue,
  references: ScenarioReferences,
  context: z.RefinementCtx,
): void => {
  for (const evidenceId of request.evidenceIds) {
    if (!references.evidenceIds.has(evidenceId)) {
      addReferenceIssue(
        context,
        ['forgetRequests', requestIndex, 'evidenceIds'],
        `unknown forget evidence reference: ${evidenceId}`,
      )
    }
    const outsideScope = scenario.events.some(
      (event) => event.evidenceId === evidenceId && !sameMemoryScope(event.scope, request.scope),
    )
    if (outsideScope) {
      addReferenceIssue(
        context,
        ['forgetRequests', requestIndex, 'scope'],
        `forget evidence is outside authorized scope: ${evidenceId}`,
      )
    }
  }
}

const validateForgetRequest = (
  request: ForgetRequest,
  requestIndex: number,
  scenario: MemoryScenarioValue,
  references: ScenarioReferences,
  context: z.RefinementCtx,
): void => {
  if (!sameMemoryScope(request.scope, scenario.primaryScope)) {
    addReferenceIssue(
      context,
      ['forgetRequests', requestIndex, 'scope'],
      'forget scope must equal primary scenario scope',
    )
  }
  if (request.kind === 'evidence') {
    validateEvidenceForget(request, requestIndex, scenario, references, context)
  }
  const subjectExists =
    request.kind !== 'subject' ||
    references.entityScopes.some(
      ({ entityId, scope }) => entityId === request.subjectId && sameMemoryScope(scope, request.scope),
    )
  if (!subjectExists && request.kind === 'subject') {
    addReferenceIssue(
      context,
      ['forgetRequests', requestIndex, 'subjectId'],
      `unknown subject in authorized scope: ${request.subjectId}`,
    )
  }
}

const validateScenario = (scenario: MemoryScenarioValue, context: z.RefinementCtx): void => {
  const references = createReferences(scenario)
  validateLocalIds(scenario, context)
  validateEvents(scenario, context)
  validateQueries(scenario, references, context)
  validateFaults(scenario, references, context)
  scenario.forgetRequests.forEach((request, requestIndex) => {
    validateForgetRequest(request, requestIndex, scenario, references, context)
  })
}

export const MemoryScenarioSchema = memoryScenarioBaseSchema.superRefine(validateScenario).readonly()
export type MemoryScenario = z.infer<typeof MemoryScenarioSchema>
