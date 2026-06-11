// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitUser } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import { DISCLOSURE_INJECTED_TOOL_NAMES, DISCLOSURE_STALL_STEPS } from './core.js'
import type { DisclosureSession } from './registry.js'

const log = logger.child({ scope: 'disclosure:prepare-step' })

type CompletedStep = { toolCalls?: ReadonlyArray<{ toolName: string }> }
type PrepareStepArg = { stepNumber: number; steps?: readonly CompletedStep[] }
type PrepareStepResult = { activeTools?: string[] }

function isMetaOnlyStep(step: CompletedStep): boolean {
  const calls = step.toolCalls ?? []
  if (calls.length === 0) return false
  return calls.every((c) => DISCLOSURE_INJECTED_TOOL_NAMES.has(c.toolName))
}

/** True when the trailing window is nothing but search/load churn — discovery without progress. */
function isMetaChurn(steps: readonly CompletedStep[] | undefined): boolean {
  if (steps === undefined || steps.length < DISCLOSURE_STALL_STEPS) return false
  return steps.slice(-DISCLOSURE_STALL_STEPS).every((step) => isMetaOnlyStep(step))
}

export function createDisclosurePrepareStep(
  session: DisclosureSession,
  contextId: string,
  turnId?: string,
): (arg: PrepareStepArg) => PrepareStepResult {
  // Latch: once opened, stay open for the turn — re-narrowing would strip tools mid-flow.
  let fallbackOpen = false
  return ({ stepNumber, steps }) => {
    const preLoadStall = !session.hasLoaded() && stepNumber >= DISCLOSURE_STALL_STEPS
    if (fallbackOpen || preLoadStall || isMetaChurn(steps)) {
      if (!fallbackOpen) {
        fallbackOpen = true
        emitUser('disclosure:fallback', contextId, { stepNumber }, turnId)
        log.warn({ contextId, stepNumber, turnId }, 'Disclosure stalled; opening all tools')
      }
      return {}
    }
    return { activeTools: session.activeToolNames() }
  }
}
