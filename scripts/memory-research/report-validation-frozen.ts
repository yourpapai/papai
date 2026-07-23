// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  combineScenarioFaultSchedule,
  expectedLifecycleSteps,
  FROZEN_SYNTHETIC_SUITE,
  frozenScenario,
  frozenSplitScenarioIds,
} from './frozen-run-contract.js'
import { selectionDigest } from './report-identity.js'
import type { CandidateResearchResult, ResearchReport, ScenarioSelection } from './report-schema.js'
import type { MemoryScenario } from './types.js'

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const frozenScenarios = (report: ResearchReport): readonly MemoryScenario[] =>
  report.selection.scenarioIds.flatMap((scenarioId) => {
    const scenario = frozenScenario(scenarioId)
    return scenario === undefined ? [] : [scenario]
  })

export const frozenSelectionErrors = (report: ResearchReport): readonly string[] => {
  const { selection } = report
  const expectedIds = [...selection.scenarioIds].sort((left, right) => left.localeCompare(right))
  const selected = frozenScenarios(report)
  return [
    ...(selection.suite === FROZEN_SYNTHETIC_SUITE ? [] : ['selection suite is not the frozen v3 suite']),
    ...(sameJson(selection.scenarioIds, expectedIds) ? [] : ['selection scenario IDs are not sorted']),
    ...(selection.selectionSha256 === selectionDigest(selection.suite, selection.split, selection.scenarioIds)
      ? []
      : ['selection SHA-256 mismatch']),
    ...(selected.length === selection.scenarioIds.length ? [] : ['selection contains an unknown frozen scenario ID']),
    ...(selected.every(({ split }) => split === selection.split)
      ? []
      : ['selection split does not match the frozen scenario split']),
  ]
}

export const isCompleteFrozenSplit = (selection: ScenarioSelection): boolean =>
  sameJson(selection.scenarioIds, frozenSplitScenarioIds(selection.split))

const frozenQueryErrors = (
  candidate: CandidateResearchResult,
  selected: readonly MemoryScenario[],
): readonly string[] =>
  candidate.scenarios.flatMap((scenarioResult) => {
    const frozen = selected.find(({ scenarioId }) => scenarioId === scenarioResult.scenarioId)
    return frozen !== undefined &&
      sameJson(
        scenarioResult.queries.map(({ query }) => query),
        frozen.queries,
      )
      ? []
      : [`${candidate.registration.id}/${scenarioResult.scenarioId}: frozen query definition mismatch`]
  })

const manifestTimeoutErrors = (candidate: CandidateResearchResult): readonly string[] => {
  const queryTimeoutMs = candidate.manifest.candidate.config['queryTimeoutMs']
  const workerDeadlineMs = candidate.manifest.candidate.config['workerDeadlineMs']
  const validQueryTimeout = Number.isInteger(queryTimeoutMs) && Number(queryTimeoutMs) > 0
  const validWorkerDeadline = Number.isInteger(workerDeadlineMs) && Number(workerDeadlineMs) > 0
  return [
    ...(validQueryTimeout ? [] : [`${candidate.registration.id}: manifest config lacks queryTimeoutMs`]),
    ...(validWorkerDeadline ? [] : [`${candidate.registration.id}: manifest config lacks workerDeadlineMs`]),
    ...(validQueryTimeout && validWorkerDeadline && Number(workerDeadlineMs) >= Number(queryTimeoutMs)
      ? []
      : [`${candidate.registration.id}: workerDeadlineMs must cover queryTimeoutMs`]),
  ]
}

export const frozenCandidateErrors = (
  report: ResearchReport,
  candidate: CandidateResearchResult,
): readonly string[] => {
  const selected = frozenScenarios(report)
  const scenarioIds = candidate.scenarios.map(({ scenarioId }) => scenarioId)
  const expectedSchedule = combineScenarioFaultSchedule(selected)
  return [
    ...(sameJson(scenarioIds, report.selection.scenarioIds)
      ? []
      : [`${candidate.registration.id}: scenario selection mismatch`]),
    ...frozenQueryErrors(candidate, selected),
    ...(candidate.manifest.split === report.selection.split
      ? []
      : [`${candidate.registration.id}: manifest split mismatch`]),
    ...(sameJson(candidate.manifest.faultConfiguration, expectedSchedule)
      ? []
      : [`${candidate.registration.id}: frozen fault schedule mismatch`]),
    ...manifestTimeoutErrors(candidate),
  ]
}

const lifecycleKey = ({ kind, referenceId }: Readonly<{ kind: string; referenceId: string }>): string =>
  `${kind}\u0000${referenceId}`

export type LifecycleValidation = Readonly<{
  complete: boolean
  completeScenarioIds: ReadonlySet<string>
  errors: readonly string[]
}>

export const validateLifecycle = (report: ResearchReport, candidate: CandidateResearchResult): LifecycleValidation => {
  const ordinalErrors = candidate.lifecycle.flatMap((entry, index) =>
    entry.ordinal === index ? [] : [`${candidate.registration.id}: lifecycle ordinal mismatch at ${index}`],
  )
  const perScenario = report.selection.scenarioIds.map((scenarioId) => {
    const frozen = frozenScenario(scenarioId)
    if (frozen === undefined) {
      return { complete: false, errors: [`${candidate.registration.id}: unknown lifecycle scenario ${scenarioId}`] }
    }
    const expected = expectedLifecycleSteps(frozen, candidate.manifest.scale).map(lifecycleKey)
    const actualEntries = candidate.lifecycle.filter((entry) => entry.scenarioId === scenarioId)
    const actual = actualEntries.map(lifecycleKey)
    const prefixMatches = sameJson(actual, expected.slice(0, actual.length))
    return {
      complete: prefixMatches && actual.length === expected.length,
      errors: prefixMatches ? [] : [`${candidate.registration.id}/${scenarioId}: lifecycle closure/order mismatch`],
    }
  })
  const selectedIds = new Set(report.selection.scenarioIds)
  const foreignErrors = candidate.lifecycle
    .filter(({ scenarioId }) => !selectedIds.has(scenarioId))
    .map(({ scenarioId }) => `${candidate.registration.id}: lifecycle references unselected scenario ${scenarioId}`)
  const actualScenarioOrder = candidate.lifecycle
    .map(({ scenarioId }) => scenarioId)
    .filter((scenarioId, index, values) => index === 0 || values[index - 1] !== scenarioId)
  const expectedScenarioOrder = report.selection.scenarioIds.filter((scenarioId) =>
    candidate.lifecycle.some((entry) => entry.scenarioId === scenarioId),
  )
  const orderErrors = sameJson(actualScenarioOrder, expectedScenarioOrder)
    ? []
    : [`${candidate.registration.id}: lifecycle scenario order mismatch`]
  return {
    complete: perScenario.every(({ complete }) => complete),
    completeScenarioIds: new Set(
      perScenario.flatMap((result, index) => (result.complete ? [report.selection.scenarioIds[index]!] : [])),
    ),
    errors: [...ordinalErrors, ...perScenario.flatMap(({ errors }) => errors), ...foreignErrors, ...orderErrors],
  }
}
