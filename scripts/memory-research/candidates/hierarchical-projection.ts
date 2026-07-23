// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { deterministicTokens } from '../deterministic-embedding.js'
import type { ForgetRequest, MemoryEvent, MemoryScope } from '../types.js'
import { sameScope } from './shared.js'

const hierarchyStopwords = new Set([
  'a',
  'an',
  'and',
  'at',
  'do',
  'does',
  'for',
  'had',
  'has',
  'have',
  'in',
  'is',
  'of',
  'on',
  'the',
  'to',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'а',
  'в',
  'где',
  'для',
  'и',
  'из',
  'как',
  'какой',
  'когда',
  'на',
  'по',
  'что',
  'это',
])

export type DerivativeKind = 'fact' | 'session' | 'topic'
export type DerivedMemory = Readonly<{
  derivedId: string
  kind: DerivativeKind
  label: string
  scope: MemoryScope
  evidenceIds: readonly MemoryEvent['evidenceId'][]
  tokens: readonly string[]
  validity: MemoryEvent['validity']
}>
export type HierarchyState = Readonly<{
  derivatives: ReadonlyMap<string, DerivedMemory>
  inverted: ReadonlyMap<string, ReadonlySet<string>>
  dependencies: ReadonlyMap<string, ReadonlySet<string>>
}>
export type HierarchyTombstone =
  | Readonly<{ kind: 'evidence'; scope: MemoryScope; evidenceIds: readonly string[] }>
  | Readonly<{ kind: 'subject'; scope: MemoryScope; subjectId: string }>
  | Readonly<{ kind: 'scope'; scope: MemoryScope }>

type MutableGroup = {
  kind: 'session' | 'topic'
  label: string
  scope: MemoryScope
  events: Map<string, MemoryEvent>
  labelTokens: Set<string>
}

export const emptyHierarchyState = (): HierarchyState => ({
  derivatives: new Map(),
  inverted: new Map(),
  dependencies: new Map(),
})

export const meaningfulHierarchyTokens = (text: string): readonly string[] => [
  ...new Set(
    deterministicTokens(text).filter(
      (token) => token.length > 1 && !hierarchyStopwords.has(token) && !/^\p{N}+$/u.test(token),
    ),
  ),
]

export const eventHierarchyTokens = (event: MemoryEvent): readonly string[] =>
  meaningfulHierarchyTokens(
    [
      event.content,
      ...event.entities.flatMap(({ name, aliases, type }) => [name, ...aliases, type]),
      ...event.relations.map(({ type }) => type),
    ].join(' '),
  )

export const hierarchyEventValidAt = (event: MemoryEvent, queryTime: string): boolean => {
  const queryEpoch = Date.parse(queryTime)
  const fromEpoch = Date.parse(event.validity.validFrom)
  const toEpoch = event.validity.validTo === null ? null : Date.parse(event.validity.validTo)
  return fromEpoch <= queryEpoch && (toEpoch === null || queryEpoch < toEpoch)
}

export const hierarchyEventAffectedBy = (event: MemoryEvent, request: ForgetRequest): boolean =>
  sameScope(event.scope, request.scope) &&
  (request.kind === 'scope' ||
    (request.kind === 'evidence' && request.evidenceIds.includes(event.evidenceId)) ||
    (request.kind === 'subject' && event.entities.some(({ entityId }) => entityId === request.subjectId)))

export const hierarchyTombstoneFor = (request: ForgetRequest): HierarchyTombstone =>
  request.kind === 'scope'
    ? { kind: 'scope', scope: request.scope }
    : request.kind === 'subject'
      ? { kind: 'subject', scope: request.scope, subjectId: request.subjectId }
      : { kind: 'evidence', scope: request.scope, evidenceIds: request.evidenceIds }

export const hierarchyTombstoneBlocks = (event: MemoryEvent, tombstone: HierarchyTombstone): boolean =>
  sameScope(event.scope, tombstone.scope) &&
  (tombstone.kind === 'scope' ||
    (tombstone.kind === 'evidence' && tombstone.evidenceIds.includes(event.evidenceId)) ||
    (tombstone.kind === 'subject' && event.entities.some(({ entityId }) => entityId === tombstone.subjectId)))

const scopeKey = (scope: MemoryScope): string => `${scope.kind}:${scope.id}`
const compareCanonical = (left: MemoryEvent, right: MemoryEvent): number =>
  Date.parse(left.eventTime) - Date.parse(right.eventTime) ||
  left.evidenceId.localeCompare(right.evidenceId) ||
  left.eventId.localeCompare(right.eventId)

const aggregateValidity = (events: readonly MemoryEvent[]): MemoryEvent['validity'] => {
  const validFrom = events.reduce(
    (earliest, { validity }) => (Date.parse(validity.validFrom) < Date.parse(earliest) ? validity.validFrom : earliest),
    events[0]!.validity.validFrom,
  )
  const openEnded = events.some(({ validity }) => validity.validTo === null)
  const closedValidTo = events
    .flatMap(({ validity }) => (validity.validTo === null ? [] : [validity.validTo]))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
  return { validFrom, validTo: openEnded ? null : (closedValidTo ?? null) }
}

const addGroupEvent = (
  groups: Map<string, MutableGroup>,
  key: string,
  kind: MutableGroup['kind'],
  label: string,
  event: MemoryEvent,
  labelTokens: readonly string[],
): void => {
  const current = groups.get(key)
  if (current === undefined) {
    groups.set(key, {
      kind,
      label,
      scope: event.scope,
      events: new Map([[event.eventId, event]]),
      labelTokens: new Set(labelTokens),
    })
    return
  }
  current.events.set(event.eventId, event)
  labelTokens.forEach((token) => {
    current.labelTokens.add(token)
  })
}

const topicDescriptors = (
  event: MemoryEvent,
): readonly Readonly<{ key: string; label: string; tokens: readonly string[] }>[] => {
  if (event.entities.length > 0) {
    return event.entities.map((entity) => ({
      key: `entity:${entity.entityId}`,
      label: entity.name,
      tokens: meaningfulHierarchyTokens([entity.name, ...entity.aliases, entity.type].join(' ')),
    }))
  }
  const fallback = eventHierarchyTokens(event)[0] ?? event.type
  return [{ key: `type:${event.type}:${fallback}`, label: fallback, tokens: [fallback] }]
}

const collectGroups = (events: readonly MemoryEvent[]): ReadonlyMap<string, MutableGroup> => {
  const groups = new Map<string, MutableGroup>()
  events.forEach((event) => {
    const scopePrefix = scopeKey(event.scope)
    const sessionLabel = event.threadId ?? event.eventTime.slice(0, 10)
    addGroupEvent(
      groups,
      `session:${scopePrefix}:${sessionLabel}`,
      'session',
      sessionLabel,
      event,
      meaningfulHierarchyTokens(sessionLabel),
    )
    topicDescriptors(event).forEach((topic) => {
      addGroupEvent(groups, `topic:${scopePrefix}:${topic.key}`, 'topic', topic.label, event, topic.tokens)
    })
  })
  return groups
}

const factDerivatives = (events: readonly MemoryEvent[]): readonly DerivedMemory[] =>
  events
    .filter(({ type }) => type !== 'message')
    .map((event) => ({
      derivedId: `fact:${scopeKey(event.scope)}:${event.evidenceId}`,
      kind: 'fact' as const,
      label: event.type,
      scope: event.scope,
      evidenceIds: [event.evidenceId],
      tokens: eventHierarchyTokens(event),
      validity: event.validity,
    }))

const groupDerivatives = (groups: ReadonlyMap<string, MutableGroup>): readonly DerivedMemory[] =>
  [...groups].map(([derivedId, group]) => {
    const members = [...group.events.values()].sort(compareCanonical)
    return {
      derivedId,
      kind: group.kind,
      label: group.label,
      scope: group.scope,
      evidenceIds: members.map(({ evidenceId }) => evidenceId),
      tokens: [...new Set([...group.labelTokens, ...members.flatMap(eventHierarchyTokens)])].sort(),
      validity: aggregateValidity(members),
    }
  })

const indexDerivatives = (
  derivatives: readonly DerivedMemory[],
  values: (derivative: DerivedMemory) => readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const index = new Map<string, Set<string>>()
  derivatives.forEach((derivative) => {
    values(derivative).forEach((value) => {
      const ids = index.get(value)
      if (ids === undefined) index.set(value, new Set([derivative.derivedId]))
      else ids.add(derivative.derivedId)
    })
  })
  return index
}

export const buildHierarchyState = (canonical: ReadonlyMap<string, MemoryEvent>): HierarchyState => {
  const events = [...canonical.values()].sort(compareCanonical)
  const nodes = [...factDerivatives(events), ...groupDerivatives(collectGroups(events))]
  return {
    derivatives: new Map(nodes.map((derivative) => [derivative.derivedId, derivative])),
    inverted: indexDerivatives(nodes, ({ tokens }) => tokens),
    dependencies: indexDerivatives(nodes, ({ evidenceIds }) => evidenceIds),
  }
}

export const hierarchyStateBytes = (hierarchy: HierarchyState): number => {
  if (hierarchy.derivatives.size === 0) return 0
  const serializable = {
    derivatives: [...hierarchy.derivatives.values()],
    inverted: [...hierarchy.inverted.entries()].map(([token, ids]) => [token, [...ids].sort()]),
    dependencies: [...hierarchy.dependencies.entries()].map(([evidenceId, ids]) => [evidenceId, [...ids].sort()]),
  }
  return new TextEncoder().encode(JSON.stringify(serializable)).byteLength
}
