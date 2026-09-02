// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getCachedHistory } from '../cache.js'
import { subscribe as subscribeDebugEvent, unsubscribe as unsubscribeDebugEvent } from '../debug/event-bus.js'
import { recentLlm } from '../debug/llm-trace-collector.js'
import { getAlertPrompt, listAlertPrompts } from '../deferred-prompts/alerts.js'
import {
  PROOF_CHECKS,
  runProofCheck,
  type ProofCheckDeps,
  type ProofCheckId,
} from '../deferred-prompts/proof-checks.js'
import { appendProofRecord } from '../deferred-prompts/proof-store.js'
import { getScheduledPrompt, listScheduledPrompts } from '../deferred-prompts/scheduled.js'
import { executeCancel, executeCreate, executeGet, executeUpdate } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:run-proof-check' })

const productionProofCheckDeps = (): ProofCheckDeps => {
  // The opaque-handle deps contract (ProofCheckDeps.setTimeout -> unknown) needs a
  // concrete-type bridge for the stdlib clearTimeout; the map doubles as the pending
  // registry, so every entry must be dropped when its timer clears OR fires naturally.
  const timerHandles = new Map<unknown, ReturnType<typeof setTimeout>>()
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      const handle = setTimeout((): void => {
        timerHandles.delete(handle)
        fn()
      }, ms)
      timerHandles.set(handle, handle)
      return handle
    },
    clearTimeout: (handle) => {
      const known = timerHandles.get(handle)
      if (known !== undefined) clearTimeout(known)
      timerHandles.delete(handle)
    },
    subscribe: subscribeDebugEvent,
    unsubscribe: unsubscribeDebugEvent,
    executeCreate: (userId, input, deliveryCtx) =>
      deliveryCtx === undefined ? executeCreate(userId, input) : executeCreate(userId, input, deliveryCtx),
    executeUpdate,
    executeGet,
    executeCancel,
    listScheduledPrompts,
    listAlertPrompts,
    getScheduledPrompt,
    getAlertPrompt,
    store: {
      append: (record) => appendProofRecord(record),
    },
    readRecentLlm: () => recentLlm,
    readCachedHistory: (storageContextId) => getCachedHistory(storageContextId),
  }
}

const isProofCheckId = (value: string): value is ProofCheckId => Object.hasOwn(PROOF_CHECKS, value)

const CHECK_IDS = Object.keys(PROOF_CHECKS).filter(isProofCheckId)

const CHECK_DESCRIPTION =
  'Which proof check to run: bug1_delivery_matches_execution (async; compares the delivered message with the execution result), ' +
  'bug2_context_time (async; compares the <current_time> anchor with the real fire clock), ' +
  'bug3_fires_on_creation (async; detects an execution before fire_at; variants: scheduled, alert), ' +
  'bug4_create_response_mode (sync; reads execution.mode off the create_reminder response), ' +
  'bug5_update_preserves_prompt (sync; verifies an empty-prompt update keeps the stored text). ' +
  'Omit check and pass cleanup: true to sweep leftover proof prompts instead.'

const proofCheckInputSchema = z
  .object({
    check: z.enum(CHECK_IDS).optional().describe(CHECK_DESCRIPTION),
    variant: z
      .string()
      .optional()
      .describe(
        'Optional check variant: scheduled or alert for bug3_fires_on_creation; no_tools or with_tool_probe for bug1_delivery_matches_execution.',
      ),
    wait_seconds: z
      .number()
      .int()
      .positive()
      .max(900)
      .optional()
      .describe(
        'Observation window in seconds for async checks; floored at the lane default of two poll intervals, hard cap 900 (15 minutes).',
      ),
    cleanup: z
      .boolean()
      .optional()
      .describe(
        'Cancel leftover proof prompts owned by this admin instead of running a check; mutually exclusive with check.',
      ),
  })
  .superRefine((value, ctx) => {
    if (value.cleanup === true && value.check !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'cleanup is mutually exclusive with check' })
    }
  })

/**
 * Admin-only disposable proof-check runner. Assembled beside the diagnostics
 * family under the same fail-closed gate; the bound ids are fixed at assembly
 * time and an empty binding degrades to the runner's structured error.
 */
export const makeRunProofCheckTool = (
  storageContextId: string,
  chatUserId: string,
  deps: ProofCheckDeps = productionProofCheckDeps(),
): Tool => {
  return tool({
    description:
      'Run a deferred-prompt proof check against the live pipeline and record the verdict. Sync checks return the finished record; async checks return a started run id and finish in the background. Admin-only disposable diagnostics.',
    inputSchema: proofCheckInputSchema,
    execute: (input) => {
      log.debug(
        { check: input.check, variant: input.variant, cleanup: input.cleanup === true },
        'run_proof_check called',
      )
      return runProofCheck(deps, {
        check: input.check,
        variant: input.variant,
        wait_seconds: input.wait_seconds,
        cleanup: input.cleanup,
        storageContextId,
        chatUserId,
      })
    },
  })
}
