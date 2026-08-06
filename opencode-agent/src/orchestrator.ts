// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSlashCommand } from './commands.js'
import type { SlashCommand } from './commands.js'
import { evaluateGuardrails } from './guardrails.js'
import type { TriggerEvent } from './guardrails.js'
import type { PhaseDeps, PhaseHandler, PhaseInput, PhaseOutcome } from './phase-context.js'
import { handleDeliver } from './phases/deliver.js'
import { handleImplement } from './phases/implement.js'
import { handlePlan } from './phases/plan.js'
import { handleTriage } from './phases/triage.js'
import { findLatestState, initialState, renderStateComment, transition } from './state-manager.js'
import type { IssueComment } from './state-manager.js'
import { errorMessage } from './types.js'
import type { AgentState, Phase, TransitionSignal } from './types.js'

/**
 * Phases the pipeline can act on unattended. A phase with no handler is a
 * waiting state: the run stops there until a maintainer comments.
 */
const HANDLERS: Partial<Record<Phase, PhaseHandler>> = {
  INIT_OR_CLARIFY: handleTriage,
  EXECUTION_PLAN: handlePlan,
  REVIEW_AND_MUTATE: handleImplement,
  PR_DELIVERY: handleDeliver,
}

/**
 * Signals that hand control back to a human even though the resulting phase has
 * a handler. Without this, asking a clarifying question would immediately
 * re-enter triage and ask again, forever.
 */
const WAITING_SIGNALS: ReadonlySet<TransitionSignal> = new Set(['NEEDS_CLARIFICATION'])

/** Signal a slash command injects before the phase handlers run. */
const COMMAND_SIGNALS: Record<SlashCommand, TransitionSignal> = {
  '/approve': 'APPROVED',
  '/replan': 'NEEDS_CLARIFICATION',
  '/retry': 'RETRY',
  '/cancel': 'CANCELLED',
}

export type RunStatus = 'skipped' | 'waiting' | 'completed' | 'failed'

export interface RunResult {
  status: RunStatus
  reason: string
  state: AgentState | null
}

export interface RunOptions {
  event: TriggerEvent
  deps: PhaseDeps
}

/**
 * One CI job = one call. Restores state from the issue thread, applies the
 * triggering command, then runs phase handlers back-to-back until the machine
 * reaches a waiting state, COMPLETE, or a failure.
 */
export const runPipeline = async (options: RunOptions): Promise<RunResult> => {
  const { event, deps } = options

  const guard = evaluateGuardrails(event, { selfLogin: deps.config.selfLogin })
  if (!guard.allowed) {
    deps.log.warn({ code: guard.code, sender: event.senderLogin }, 'Trigger rejected by guardrails')
    return { status: 'skipped', reason: guard.reason, state: null }
  }

  const thread = await deps.github.listIssueComments(event.issueNumber)
  const restored = findLatestState(thread, deps.config.selfLogin) ?? initialState(event.issueNumber)
  const command = parseSlashCommand(event.commentBody)

  const entry = applyCommand(restored, command, deps)
  if (entry.halt !== null) return entry.halt

  return driveMachine({ state: entry.state, event, command, thread, deps })
}

interface CommandOutcome {
  state: AgentState
  halt: RunResult | null
}

/**
 * Turns the triggering comment into a state move. A comment with no command is
 * only meaningful while the agent is waiting for clarification; anywhere else it
 * is ordinary human discussion and must not re-run a phase.
 */
const applyCommand = (state: AgentState, command: SlashCommand | null, deps: PhaseDeps): CommandOutcome => {
  if (command === null) {
    if (state.phase === 'INIT_OR_CLARIFY') return { state, halt: null }
    return { state, halt: skip(state, `No actionable command while in ${state.phase}`) }
  }

  const signal = COMMAND_SIGNALS[command]
  try {
    const next = transition(state, signal)
    deps.log.info({ command, from: state.phase, to: next.phase }, 'Applied maintainer command')
    return { state: next, halt: null }
  } catch (error) {
    return { state, halt: skip(state, `${command} is not valid in ${state.phase}: ${errorMessage(error)}`) }
  }
}

interface MachineInput {
  state: AgentState
  event: TriggerEvent
  command: SlashCommand | null
  thread: readonly IssueComment[]
  deps: PhaseDeps
}

/**
 * Runs handlers back-to-back. Recursion rather than a loop: each step's result
 * feeds the next call's state and thread, and the repo forbids awaiting inside a
 * loop body. The cascade ends at a phase with no handler.
 */
const driveMachine = async (input: MachineInput): Promise<RunResult> => {
  const { deps, event, state, thread } = input

  const handler = HANDLERS[state.phase]
  if (handler === undefined) {
    return state.phase === 'COMPLETE'
      ? { status: 'completed', reason: 'Pipeline finished', state }
      : { status: 'waiting', reason: `Waiting for a maintainer in ${state.phase}`, state }
  }

  if (state.attempts >= deps.config.maxAttempts) {
    return { status: 'failed', reason: `Retry budget exhausted (${state.attempts} attempts)`, state }
  }

  const attempt = await runHandler(handler, { state, event, command: input.command, thread, deps })
  if (!attempt.ok) return failRun(state, event, thread, deps, attempt.error)

  const { signal, comment, patch } = attempt.outcome
  const next = transition(state, signal, patch ?? {})
  const grown = await postAndAppend(thread, event, deps, comment, next)

  if (WAITING_SIGNALS.has(signal)) {
    return { status: 'waiting', reason: `Waiting for a maintainer reply in ${next.phase}`, state: next }
  }

  return driveMachine({ ...input, state: next, thread: grown })
}

type HandlerAttempt = { ok: true; outcome: PhaseOutcome } | { ok: false; error: unknown }

const runHandler = async (handler: PhaseHandler, input: PhaseInput): Promise<HandlerAttempt> => {
  try {
    return { ok: true, outcome: await handler(input) }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * Records the failure on the issue and parks the state in FAILED with
 * `resumeFrom` set, so `/retry` re-enters the exact phase that broke instead of
 * replaying the whole pipeline.
 */
const failRun = async (
  state: AgentState,
  event: TriggerEvent,
  thread: readonly IssueComment[],
  deps: PhaseDeps,
  error: unknown,
): Promise<RunResult> => {
  const message = errorMessage(error)
  deps.log.error({ issue: state.issueId, phase: state.phase, error: message }, 'Phase handler failed')

  const failed = transition(state, 'FAILED', { lastError: message })
  await postAndAppend(thread, event, deps, renderFailure(state.phase, message, failed), failed)

  return { status: 'failed', reason: message, state: failed }
}

const renderFailure = (phase: Phase, message: string, next: AgentState): string =>
  [
    `### Run failed in ${phase}`,
    '',
    '```',
    message,
    '```',
    '',
    next.attempts >= 1
      ? `Attempt ${next.attempts}. Reply **\`/retry\`** to resume from \`${phase}\`, or **\`/cancel\`** to stop.`
      : `Reply **\`/retry\`** to resume from \`${phase}\`.`,
  ].join('\n')

/**
 * Posts a comment and mirrors it into the in-memory thread, so a later phase in
 * the same job can read a section (spec, plan, report) the earlier phase just
 * wrote without re-fetching the issue.
 */
const postAndAppend = async (
  thread: readonly IssueComment[],
  event: TriggerEvent,
  deps: PhaseDeps,
  body: string,
  state: AgentState,
): Promise<IssueComment[]> => {
  const rendered = renderStateComment(body, state)
  const posted = await deps.github.createComment(event.issueNumber, rendered)
  return [...thread, { id: posted.id, body: rendered, authorLogin: deps.config.selfLogin }]
}

const skip = (state: AgentState, reason: string): RunResult => ({ status: 'skipped', reason, state })
