// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { memoryScenarios } from './corpus.js'
import { FROZEN_SCENARIO_MANIFEST } from './scenario-manifest.js'
import type { ScenarioManifest } from './scenario-manifest.js'
import { RunManifestBaseSchema } from './types.js'
import type { MemoryScenario, MemoryScope } from './types.js'

type BaseRunManifest = z.infer<typeof RunManifestBaseSchema>
type ScheduledForgetRequest = BaseRunManifest['faultConfiguration']['forgetRequests'][number]
type FrozenEvidenceId = MemoryScenario['events'][number]['evidenceId']

const scopeEquals = (left: MemoryScope, right: MemoryScope): boolean => left.kind === right.kind && left.id === right.id

const frozenEvidence = new Map(
  memoryScenarios.flatMap((scenario) => scenario.events.map((event) => [event.evidenceId, event] as const)),
)
const frozenEventIds = new Set(memoryScenarios.flatMap(({ events }) => events.map(({ eventId }) => eventId)))
const frozenQueryIds = new Set(memoryScenarios.flatMap(({ queries }) => queries.map(({ queryId }) => queryId)))
const scopeKey = (scope: MemoryScope): string => `${scope.kind}:${scope.id}`
const frozenScopeKeys = new Set(
  memoryScenarios.flatMap((scenario) => [
    scopeKey(scenario.primaryScope),
    ...scenario.events.map(({ scope }) => scopeKey(scope)),
  ]),
)
const frozenEntities = memoryScenarios.flatMap(({ events }) =>
  events.flatMap((event) =>
    event.entities.map(({ entityId }) => ({
      entityId,
      scope: event.scope,
    })),
  ),
)

const forgetCoversEvidence = (request: ScheduledForgetRequest, evidenceId: FrozenEvidenceId): boolean => {
  const event = frozenEvidence.get(evidenceId)
  if (event === undefined) return false
  if (request.kind === 'scope') return scopeEquals(request.scope, event.scope)
  if (request.kind === 'evidence') {
    return scopeEquals(request.scope, event.scope) && request.evidenceIds.includes(event.evidenceId)
  }
  return (
    scopeEquals(request.scope, event.scope) && event.entities.some(({ entityId }) => entityId === request.subjectId)
  )
}

const addRunIssue = (context: z.RefinementCtx, path: readonly PropertyKey[], message: string): void => {
  context.addIssue({ code: 'custom', path: [...path], message })
}

const validateRunIdentity = (manifest: BaseRunManifest, identity: ScenarioManifest, context: z.RefinementCtx): void => {
  if (manifest.scenarioManifestVersion !== identity.scenarioManifestVersion) {
    addRunIssue(context, ['scenarioManifestVersion'], 'scenario manifest version does not match frozen corpus')
  }
  if (manifest.scenarioManifestSha256 !== identity.scenarioManifestSha256) {
    addRunIssue(context, ['scenarioManifestSha256'], 'scenario manifest digest does not match frozen corpus')
  }
}

const validateFaultReferences = (manifest: BaseRunManifest, context: z.RefinementCtx): void => {
  const schedule = manifest.faultConfiguration
  const evidenceReferences = [
    ...schedule.missingEmbeddingEvidenceIds,
    ...schedule.duplicateEvidenceIds,
    ...schedule.nonRecaptureEvidenceIds,
    ...schedule.embeddingVersionChanges.map(({ evidenceId }) => evidenceId),
  ]
  for (const evidenceId of evidenceReferences) {
    if (!frozenEvidence.has(evidenceId)) {
      addRunIssue(context, ['faultConfiguration'], `unknown frozen evidence reference: ${evidenceId}`)
    }
  }
  for (const eventId of schedule.ingestOrder) {
    if (!frozenEventIds.has(eventId)) {
      addRunIssue(context, ['faultConfiguration', 'ingestOrder'], `unknown frozen event reference: ${eventId}`)
    }
  }
  const queryReferences = [
    ...schedule.crossScopeProbeQueryIds,
    ...schedule.restartBeforeQueryIds,
    ...schedule.rebuildBeforeQueryIds,
  ]
  for (const queryId of queryReferences) {
    if (!frozenQueryIds.has(queryId)) {
      addRunIssue(context, ['faultConfiguration'], `unknown frozen query reference: ${queryId}`)
    }
  }
}

const validateEvidenceForget = (
  request: Extract<ScheduledForgetRequest, { kind: 'evidence' }>,
  index: number,
  context: z.RefinementCtx,
): void => {
  for (const evidenceId of request.evidenceIds) {
    const event = frozenEvidence.get(evidenceId)
    if (event === undefined || !scopeEquals(event.scope, request.scope)) {
      addRunIssue(
        context,
        ['faultConfiguration', 'forgetRequests', index],
        `forget evidence is absent from authorized scope: ${evidenceId}`,
      )
    }
  }
}

const validateForgetRequest = (request: ScheduledForgetRequest, index: number, context: z.RefinementCtx): void => {
  if (request.kind === 'evidence') {
    validateEvidenceForget(request, index, context)
  }
  const subjectExists =
    request.kind !== 'subject' ||
    frozenEntities.some(({ entityId, scope }) => entityId === request.subjectId && scopeEquals(scope, request.scope))
  if (!subjectExists && request.kind === 'subject') {
    addRunIssue(
      context,
      ['faultConfiguration', 'forgetRequests', index],
      `forget subject is absent from authorized scope: ${request.subjectId}`,
    )
  }
  if (request.kind === 'scope' && !frozenScopeKeys.has(scopeKey(request.scope))) {
    addRunIssue(
      context,
      ['faultConfiguration', 'forgetRequests', index],
      `forget scope is absent from frozen corpus: ${scopeKey(request.scope)}`,
    )
  }
}

const validateForgetSchedule = (manifest: BaseRunManifest, context: z.RefinementCtx): void => {
  const schedule = manifest.faultConfiguration
  schedule.forgetRequests.forEach((request, index) => {
    validateForgetRequest(request, index, context)
  })
  for (const evidenceId of schedule.nonRecaptureEvidenceIds) {
    const covered = schedule.forgetRequests.some((request) => forgetCoversEvidence(request, evidenceId))
    if (!covered) {
      addRunIssue(
        context,
        ['faultConfiguration', 'nonRecaptureEvidenceIds'],
        `non-recapture evidence is not covered by a forget request: ${evidenceId}`,
      )
    }
  }
}

const validateRunManifest = (manifest: BaseRunManifest, identity: ScenarioManifest, context: z.RefinementCtx): void => {
  validateRunIdentity(manifest, identity, context)
  validateFaultReferences(manifest, context)
  validateForgetSchedule(manifest, context)
}

export const createRunManifestSchema = (identity: ScenarioManifest): typeof RunManifestBaseSchema =>
  RunManifestBaseSchema.superRefine((manifest, context) => {
    validateRunManifest(manifest, identity, context)
  })

export const RunManifestSchema = createRunManifestSchema(FROZEN_SCENARIO_MANIFEST)
export type RunManifest = z.infer<typeof RunManifestSchema>
