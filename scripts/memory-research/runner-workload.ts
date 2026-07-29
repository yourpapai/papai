// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createScaleDistractors } from './corpus.js'
import { MemoryScenarioSchema } from './types.js'
import type { MemoryEvent, MemoryScenario, MemoryScope, RunManifest } from './types.js'

export type ScopeRecordCount = Readonly<{
  scope: MemoryScope
  count: number
}>

export type ScenarioWorkload = Readonly<{
  scaleEvents: readonly MemoryEvent[]
  recordedEvents: readonly MemoryEvent[]
  canonicalEvents: readonly MemoryEvent[]
  scopeRecordCounts: readonly ScopeRecordCount[]
}>

const scopeKey = (scope: MemoryScope): string => `${scope.kind}:${scope.id}`

const globallyUniqueScenarioIds = (scenarios: readonly MemoryScenario[]): boolean => {
  const ids = scenarios.flatMap(({ events, queries, scenarioId }) => [
    scenarioId,
    ...events.flatMap(({ eventId, evidenceId }) => [eventId, evidenceId]),
    ...queries.map(({ queryId }) => queryId),
  ])
  return new Set(ids).size === ids.length
}

export const selectScenarioSplit = (
  scenarios: readonly MemoryScenario[],
  split: MemoryScenario['split'],
): readonly MemoryScenario[] => {
  const parsed = MemoryScenarioSchema.array().safeParse(scenarios)
  if (!parsed.success || !globallyUniqueScenarioIds(parsed.success ? parsed.data : [])) {
    throw new Error('Invalid memory runner selection closure: malformed or cross-scenario reference')
  }
  return Object.freeze(
    parsed.data
      .filter((scenario) => scenario.split === split)
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
  )
}

const canonicalByScope = (scenario: MemoryScenario): ReadonlyMap<string, readonly MemoryEvent[]> => {
  const grouped = new Map<string, MemoryEvent[]>()
  scenario.events.forEach((event) => {
    const key = scopeKey(event.scope)
    const values = grouped.get(key) ?? []
    if (!values.some(({ eventId }) => eventId === event.eventId)) values.push(event)
    grouped.set(key, values)
  })
  return grouped
}

const recordedEvents = (scenario: MemoryScenario): readonly MemoryEvent[] => {
  const byId = new Map(scenario.events.map((event) => [event.eventId, event] as const))
  const scheduled = scenario.faults.ingestOrder.map((eventId) => byId.get(eventId))
  const scheduledIds = new Set(scheduled.flatMap((event) => (event === undefined ? [] : [event.eventId])))
  if (
    scheduled.some((event) => event === undefined) ||
    scenario.events.some(({ eventId }) => !scheduledIds.has(eventId))
  ) {
    throw new Error(`Invalid memory runner selection closure: incomplete ingest order in ${scenario.scenarioId}`)
  }
  return scheduled.flatMap((event) => (event === undefined ? [] : [event]))
}

const takeScaleEvents = (
  scenario: MemoryScenario,
  scale: RunManifest['scale'],
  seed: number,
  scope: MemoryScope,
  count: number,
): readonly MemoryEvent[] => {
  const generated = createScaleDistractors({ scale, scope, language: scenario.language, seed })
  const selected: MemoryEvent[] = []
  for (const event of generated) {
    if (selected.length === count) break
    selected.push(event)
  }
  if (selected.length !== count) throw new Error(`Unable to materialize ${count} scale rows for ${scopeKey(scope)}`)
  return selected
}

export const materializeScenarioWorkload = (
  scenarioInput: MemoryScenario,
  scale: RunManifest['scale'],
  seed: number,
): ScenarioWorkload => {
  const scenario = MemoryScenarioSchema.parse(scenarioInput)
  const grouped = canonicalByScope(scenario)
  const entries = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
  const scaleEvents = entries.flatMap(([, canonical]) => {
    const needed = scale - canonical.length
    if (needed < 0) throw new Error(`Scale ${scale} is smaller than canonical rows for ${scenario.scenarioId}`)
    return takeScaleEvents(scenario, scale, seed, canonical[0]!.scope, needed)
  })
  const scopeRecordCounts = entries.map(([, canonical]) => ({
    scope: canonical[0]!.scope,
    count:
      canonical.length + scaleEvents.filter(({ scope }) => scopeKey(scope) === scopeKey(canonical[0]!.scope)).length,
  }))
  if (scopeRecordCounts.some(({ count }) => count !== scale)) {
    throw new Error(`Scenario workload does not contain exactly ${scale} unique rows per scope`)
  }
  return Object.freeze({
    scaleEvents,
    recordedEvents: recordedEvents(scenario),
    canonicalEvents: scenario.events,
    scopeRecordCounts,
  })
}
