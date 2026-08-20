// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ProcessMessageFn } from './llm-orchestrator-process-args.js'
import type { InvocationSource } from './llm-orchestrator-tools.js'
import type { LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import type { InjectedMessage } from './run-control/types.js'

export type LeftoverReplayArgs = Readonly<{
  invocationSource: Omit<InvocationSource, 'history'>
  configContextId: string | undefined
  deps: LlmOrchestratorDeps
  processMessage: ProcessMessageFn
}>

/**
 * Steer messages that never reached a step boundary are re-enqueued as a fresh turn rather than
 * dropped. The replay is a synthetic continuation of leftover steer text, not a new user-originated
 * message, so it carries no originating message ids.
 */
export const replayLeftoverSteerAsFreshTurn = async (
  leftover: readonly InjectedMessage[],
  args: LeftoverReplayArgs,
): Promise<void> => {
  if (leftover.length === 0) return
  const { reply, contextId, chatUserId, username, contextType, actorRole, isBotAdmin, platformInstanceId } =
    args.invocationSource
  const text = leftover.map((m) => m.text).join('\n\n')
  await args.processMessage(
    reply,
    contextId,
    chatUserId,
    username,
    text,
    contextType,
    args.configContextId,
    args.deps,
    [],
    undefined,
    actorRole,
    [],
    undefined,
    isBotAdmin,
    platformInstanceId,
  )
}
