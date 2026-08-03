// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { utcDayOfMs } from '../aggregate.js'

export const FEATURE_MATERIALIZATION_VERSION = 1

export type FeatureOpportunityFact = Readonly<{
  eventId: string
  actorKey: string
  feature: string
  available: boolean
  reason: string
  occurredAtMs: number
}>

export type FeatureUseFact = Readonly<{
  eventId: string
  actorKey: string
  feature: string
  outcome: 'success' | 'failure' | 'blocked'
  occurredAtMs: number
}>

export type FeatureOpportunityDay = Readonly<{
  actorKey: string
  feature: string
  utcDay: string
  available: boolean
  reason: string
  opportunityEventId: string
  definitionVersion: typeof FEATURE_MATERIALIZATION_VERSION
}>

export type FeatureUseDay = Readonly<{
  actorKey: string
  feature: string
  utcDay: string
  successCount: number
  failureCount: number
  blockedCount: number
  joinedAvailable: boolean
  adopted: boolean
  firstUseEventId: string
  definitionVersion: typeof FEATURE_MATERIALIZATION_VERSION
}>

export type FeatureDayMaterialization = Readonly<{
  opportunities: readonly FeatureOpportunityDay[]
  uses: readonly FeatureUseDay[]
}>

const dayKey = (actorKey: string, feature: string, utcDay: string): string => `${actorKey} ${feature} ${utcDay}`

const earliestOf = <T extends { eventId: string; occurredAtMs: number }>(facts: readonly T[]): T =>
  facts.reduce((earliest, fact) =>
    fact.occurredAtMs < earliest.occurredAtMs ||
    (fact.occurredAtMs === earliest.occurredAtMs && fact.eventId < earliest.eventId)
      ? fact
      : earliest,
  )

const materializeOpportunities = (facts: readonly FeatureOpportunityFact[]): readonly FeatureOpportunityDay[] => {
  const groups = new Map<string, FeatureOpportunityFact[]>()
  for (const fact of facts) {
    const key = dayKey(fact.actorKey, fact.feature, utcDayOfMs(fact.occurredAtMs))
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [fact])
    else group.push(fact)
  }
  return [...groups.values()].map((group) => {
    const first = earliestOf(group)
    return {
      actorKey: first.actorKey,
      feature: first.feature,
      utcDay: utcDayOfMs(first.occurredAtMs),
      available: first.available,
      reason: first.reason,
      opportunityEventId: first.eventId,
      definitionVersion: FEATURE_MATERIALIZATION_VERSION,
    }
  })
}

const materializeUses = (
  facts: readonly FeatureUseFact[],
  opportunityDays: readonly FeatureOpportunityDay[],
): readonly FeatureUseDay[] => {
  const availableDays = new Set(
    opportunityDays.filter((day) => day.available).map((day) => dayKey(day.actorKey, day.feature, day.utcDay)),
  )
  const groups = new Map<string, FeatureUseFact[]>()
  for (const fact of facts) {
    const key = dayKey(fact.actorKey, fact.feature, utcDayOfMs(fact.occurredAtMs))
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [fact])
    else group.push(fact)
  }
  return [...groups.entries()].map(([key, group]) => {
    const first = earliestOf(group)
    const successCount = group.filter((fact) => fact.outcome === 'success').length
    const joinedAvailable = availableDays.has(key)
    return {
      actorKey: first.actorKey,
      feature: first.feature,
      utcDay: utcDayOfMs(first.occurredAtMs),
      successCount,
      failureCount: group.filter((fact) => fact.outcome === 'failure').length,
      blockedCount: group.filter((fact) => fact.outcome === 'blocked').length,
      joinedAvailable,
      adopted: joinedAvailable && successCount > 0,
      firstUseEventId: first.eventId,
      definitionVersion: FEATURE_MATERIALIZATION_VERSION,
    }
  })
}

export const materializeFeatureDays = (input: {
  opportunities: readonly FeatureOpportunityFact[]
  uses: readonly FeatureUseFact[]
}): FeatureDayMaterialization => {
  const opportunities = materializeOpportunities(input.opportunities)
  return { opportunities, uses: materializeUses(input.uses, opportunities) }
}

export const eligibleActorDayDenominator = (
  opportunityDays: readonly Readonly<{ feature: string; utcDay: string; available: boolean }>[],
  feature: string,
  utcDay: string,
): number => opportunityDays.filter((day) => day.feature === feature && day.utcDay === utcDay && day.available).length
