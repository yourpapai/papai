// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createPseudonym } from '../identity/pseudonym.js'
import type { SessionKeyInput } from './sessionizer.js'

export const OUTCOME_VERSION = 1
export const OUTCOME_ATTEMPT_DOMAIN = 'outcome-attempt:v1'
export const CLARIFICATION_ABANDONED_DOMAIN = 'clarification-abandoned:v1'
export const OBSERVATION_WINDOW_MS = 86_400_000
export const RECOVERY_WINDOW_MS = 1_800_000

export const TERMINAL_OUTCOMES = [
  'immediate_success',
  'recovered_same_turn',
  'recovered_next_turn',
  'unresolved_engaged',
  'abandoned_after_failure',
  'abandoned_after_clarification',
  'abandoned_after_no_action',
  'censored',
] as const

export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number]

export type ExecutedToolOutcome = 'semantic_success' | 'structured_failure' | 'thrown_failure'

export type TurnGoalFacts = Readonly<{
  turnKey: string
  actorKey: string
  conversationKey: string
  turnStartMs: number
  turnEndMs: number
  anchorEventId: string
  goals: readonly string[]
  executedOutcomes: readonly ExecutedToolOutcome[]
  clarification: boolean
  censorStartMs?: number | null
}>

export type GoalAttemptOutcome = Readonly<{
  attemptKey: string
  turnKey: string
  goal: string
  actorKey: string
  conversationKey: string
  startMs: number
  matureAtMs: number
  outcome: TerminalOutcome
  resolvedAtMs: number | null
  anchorEventId: string
  outcomeVersion: typeof OUTCOME_VERSION
}>

export type OutcomeObservationInput = Readonly<{
  nowMs: number
  censorStartMs: number | null
}>

const isFailure = (outcome: ExecutedToolOutcome): boolean => outcome !== 'semantic_success'

const sameGoalFollowUps = (turn: TurnGoalFacts, allTurns: readonly TurnGoalFacts[]): readonly TurnGoalFacts[] =>
  allTurns
    .filter(
      (candidate) =>
        candidate.turnKey !== turn.turnKey &&
        candidate.turnStartMs >= turn.turnEndMs &&
        candidate.turnStartMs <= turn.turnEndMs + OBSERVATION_WINDOW_MS &&
        turn.goals.some((goal) => candidate.goals.includes(goal)),
    )
    .sort((left, right) => left.turnStartMs - right.turnStartMs || left.turnKey.localeCompare(right.turnKey))

const classifyAttempt = (
  turn: TurnGoalFacts,
  goal: string,
  allTurns: readonly TurnGoalFacts[],
  input: OutcomeObservationInput,
): Readonly<{ outcome: TerminalOutcome; resolvedAtMs: number | null }> => {
  const matureAtMs = turn.turnEndMs + OBSERVATION_WINDOW_MS
  const firstSuccessIndex = turn.executedOutcomes.indexOf('semantic_success')
  if (firstSuccessIndex >= 0) {
    const earlierFailure = turn.executedOutcomes.slice(0, firstSuccessIndex).some(isFailure)
    return { outcome: earlierFailure ? 'recovered_same_turn' : 'immediate_success', resolvedAtMs: turn.turnEndMs }
  }
  const followUps = sameGoalFollowUps({ ...turn, goals: [goal] }, allTurns)
  const recovery = followUps.find(
    (candidate) =>
      candidate.turnStartMs - turn.turnEndMs <= RECOVERY_WINDOW_MS &&
      candidate.executedOutcomes.includes('semantic_success'),
  )
  if (recovery !== undefined) {
    return { outcome: 'recovered_next_turn', resolvedAtMs: recovery.turnEndMs }
  }
  const engaged = followUps[0]
  if (engaged !== undefined) {
    return { outcome: 'unresolved_engaged', resolvedAtMs: engaged.turnStartMs }
  }
  const censorStartMs = turn.censorStartMs ?? input.censorStartMs
  if ((censorStartMs !== null && censorStartMs < matureAtMs) || input.nowMs < matureAtMs) {
    return { outcome: 'censored', resolvedAtMs: null }
  }
  if (turn.executedOutcomes.some(isFailure)) {
    return { outcome: 'abandoned_after_failure', resolvedAtMs: matureAtMs }
  }
  if (turn.clarification) {
    return { outcome: 'abandoned_after_clarification', resolvedAtMs: matureAtMs }
  }
  return { outcome: 'abandoned_after_no_action', resolvedAtMs: matureAtMs }
}

export const buildGoalAttempts = (
  turns: readonly TurnGoalFacts[],
  input: OutcomeObservationInput,
  keyInput: SessionKeyInput,
): readonly GoalAttemptOutcome[] =>
  turns.flatMap((turn) =>
    turn.goals.slice(0, 3).map((goal) => {
      const classification = classifyAttempt(turn, goal, turns, input)
      return {
        attemptKey: createPseudonym({
          key: keyInput.key,
          keyVersion: keyInput.keyVersion,
          domain: OUTCOME_ATTEMPT_DOMAIN,
          components: [turn.turnKey, goal],
        }),
        turnKey: turn.turnKey,
        goal,
        actorKey: turn.actorKey,
        conversationKey: turn.conversationKey,
        startMs: turn.turnEndMs,
        matureAtMs: turn.turnEndMs + OBSERVATION_WINDOW_MS,
        outcome: classification.outcome,
        resolvedAtMs: classification.resolvedAtMs,
        anchorEventId: turn.anchorEventId,
        outcomeVersion: OUTCOME_VERSION,
      }
    }),
  )

export const isClarificationAbandonmentMature = (
  turn: TurnGoalFacts,
  laterTurns: readonly TurnGoalFacts[],
  input: OutcomeObservationInput,
): boolean => {
  if (!turn.clarification) return false
  const matureAtMs = turn.turnEndMs + OBSERVATION_WINDOW_MS
  if (input.nowMs < matureAtMs) return false
  const censorStartMs = turn.censorStartMs ?? input.censorStartMs
  if (censorStartMs !== null && censorStartMs < matureAtMs) return false
  const followUp = laterTurns.some(
    (candidate) =>
      candidate.turnKey !== turn.turnKey &&
      candidate.turnStartMs >= turn.turnEndMs &&
      candidate.turnStartMs <= matureAtMs &&
      (turn.goals.length === 0 || turn.goals.some((goal) => candidate.goals.includes(goal))),
  )
  return !followUp
}
