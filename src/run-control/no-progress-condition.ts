// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { DISCLOSURE_INJECTED_TOOL_NAMES } from '../tools/disclosure/core.js'

/** Trailing window of steps inspected for progress. */
export const NO_PROGRESS_STEPS = 3

/** Minimal shape of a completed step we rely on (the AI SDK StepResult is a superset). */
export type CompletedStep = { toolCalls?: ReadonlyArray<{ toolName: string }> }
/** Minimal shape of the AI SDK StopCondition argument we read. */
export type StopConditionArg = { steps: readonly CompletedStep[] }
/** A stopWhen predicate over the fields we rely on; assignable to the SDK StopCondition. */
export type ProgressStopCondition = (arg: StopConditionArg) => boolean

/**
 * A step counts as productive when it made at least one NON-meta tool call. A step that is
 * empty (no calls) or only disclosure meta-tools (search_tools/load_tool) is discovery
 * churn, not real work.
 */
function isProductiveStep(step: CompletedStep): boolean {
  const calls = step.toolCalls ?? []
  return calls.some((call) => !DISCLOSURE_INJECTED_TOOL_NAMES.has(call.toolName))
}

/**
 * A stopWhen condition that ends the agent loop early when the model is spinning: once at
 * least NO_PROGRESS_STEPS steps have run and the trailing window contains no productive
 * tool call, further steps are almost certainly churn. Stopping here avoids burning the
 * whole step budget (and the user-facing "type continue" nag) on a stalled turn.
 *
 * Assignable to the AI SDK StopCondition (a sync boolean return is allowed).
 */
export function createNoProgressCondition(): ProgressStopCondition {
  return ({ steps }) => {
    if (steps.length < NO_PROGRESS_STEPS) return false
    const window = steps.slice(-NO_PROGRESS_STEPS)
    return !window.some(isProductiveStep)
  }
}
