// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ExecutedToolOutcome } from './outcomes.js'

export const FRICTION_VERSION = 1
export const LONG_TURN_MS = 30_000

export const FRICTION_COMPONENTS = [
  'rephrase',
  'clarificationAbandoned',
  'permissionIssue',
  'stop',
  'longTurn',
  'disclosureFallback',
  'failureChain',
] as const

export type FrictionComponentName = (typeof FRICTION_COMPONENTS)[number]

export type FrictionComponents = Readonly<Record<FrictionComponentName, boolean>>

export type TurnFrictionFacts = Readonly<{
  turnKey: string
  actorKey: string
  conversationKey: string
  occurredAtMs: number
  anchorEventId: string
  durationMs: number | null
  hasRephrase: boolean
  hasClarificationAbandoned: boolean
  hasPermissionIssue: boolean
  hasStop: boolean
  hasDisclosureFallback: boolean
  executedOutcomes: readonly ExecutedToolOutcome[]
}>

export type TurnFrictionResult = Readonly<{
  turnKey: string
  actorKey: string
  conversationKey: string
  occurredAtMs: number
  anchorEventId: string
  components: FrictionComponents
  componentCount: number
  displayScore: number
  frictionVersion: typeof FRICTION_VERSION
}>

export const hasFailureChain = (outcomes: readonly ExecutedToolOutcome[]): boolean => {
  let consecutiveFailures = 0
  for (const outcome of outcomes) {
    consecutiveFailures = outcome === 'semantic_success' ? 0 : consecutiveFailures + 1
    if (consecutiveFailures >= 2) return true
  }
  return false
}

export const frictionDisplayScore = (componentCount: number): number => Math.round((100 * componentCount) / 7)

export const computeTurnFriction = (facts: TurnFrictionFacts): TurnFrictionResult => {
  const components: FrictionComponents = {
    rephrase: facts.hasRephrase,
    clarificationAbandoned: facts.hasClarificationAbandoned,
    permissionIssue: facts.hasPermissionIssue,
    stop: facts.hasStop,
    longTurn: facts.durationMs !== null && facts.durationMs > LONG_TURN_MS,
    disclosureFallback: facts.hasDisclosureFallback,
    failureChain: hasFailureChain(facts.executedOutcomes),
  }
  const componentCount = FRICTION_COMPONENTS.filter((name) => components[name]).length
  return {
    turnKey: facts.turnKey,
    actorKey: facts.actorKey,
    conversationKey: facts.conversationKey,
    occurredAtMs: facts.occurredAtMs,
    anchorEventId: facts.anchorEventId,
    components,
    componentCount,
    displayScore: frictionDisplayScore(componentCount),
    frictionVersion: FRICTION_VERSION,
  }
}
