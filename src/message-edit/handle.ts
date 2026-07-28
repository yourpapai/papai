// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, gt } from 'drizzle-orm'

import type { StagedFileDownloadFn } from '../attachments/types.js'
import { resolveMessageAuth, shouldIgnoreGroupMessage } from '../bot-guards.js'
import { cacheObservedIncomingMessage } from '../bot-message-caching.js'
import type { ChatParticipantResolver } from '../chat/participants/roster.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn } from '../chat/types.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { applyEditToHistory } from '../history.js'
import type { ProcessMessageFn } from '../llm-orchestrator-process-args.js'
import { defaultDeps } from '../llm-orchestrator.js'
import { logger } from '../logger.js'
import { getMessageByContext } from '../message-cache/store.js'
import { lastTurnRegistry, type LastTurn } from '../run-control/last-turn-registry.js'
import { runRegistry } from '../run-control/registry.js'
import { classifyEdit } from './classify.js'

const log = logger.child({ scope: 'message-edit' })

/**
 * Determine whether any user-authored message was observed in `contextId`
 * strictly after `beforeTimestamp`. Backs the W2-vs-W3 decision: a later user
 * turn means the edited message is no longer the "last" one and a W2 rerun
 * would only re-derive a stale reply.
 */
function laterUserMessageExists(contextId: string, beforeTimestamp: number): boolean {
  const row = getDrizzleDb()
    .select({ messageId: messageMetadata.messageId })
    .from(messageMetadata)
    .where(and(eq(messageMetadata.contextId, contextId), gt(messageMetadata.timestamp, beforeTimestamp)))
    .limit(1)
    .get()
  return row !== undefined
}

export type EditHandlerDeps = {
  /**
   * Production LLM-turn entry point. Required for the W2 no-side-effects rerun
   * (Task 10); the W1/W3 paths never touch it. Kept optional on the type so
   * `onIncomingEdit`'s caller (which threads a loose `BotDeps`-shaped record)
   * does not need an unsafe narrowing; `handleW2` guards `=== undefined` at
   * runtime and bails with a `warn` when missing.
   */
  processMessage?: ProcessMessageFn
  /** Optional bot-level DI forwarded into the orchestrator deps, mirroring `BotDeps`. */
  stagedDownloadFn?: StagedFileDownloadFn
  /** Optional bot-level DI forwarded into the orchestrator deps, mirroring `BotDeps`. */
  chatParticipantResolver?: ChatParticipantResolver
} & Record<string, unknown>

/**
 * Entry point for inbound message-edit events. Mirrors `onIncomingMessage`'s
 * guard sequence (auth → group filter → messageId presence → command/empty
 * short-circuits), then unconditionally applies the **baseline** correction
 * (upsert `message_metadata` + rewrite the matching user turn in
 * `conversation_history`) so every downstream window sees consistent state.
 *
 * Window dispatch (Task 6's classifier):
 *  - W1 (active run owns the edited message): inject a steer correction into
 *    the run's `steerQueue` and ack the user mid-run.
 *  - W2 (last completed turn owns it, no later user message): rerun pathway —
 *    stubbed here, implemented in Tasks 10–11.
 *  - W3 (everything else): silent — baseline already corrected the stores.
 */
export async function onIncomingEdit(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  deps: EditHandlerDeps,
): Promise<void> {
  const auth = resolveMessageAuth(msg)
  if (!auth.allowed) return
  if (shouldIgnoreGroupMessage(msg)) return
  if (msg.messageId === undefined) return
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return
  if (msg.text.length === 0) return

  const prior = getMessageByContext(auth.storageContextId, msg.messageId)
  if (prior !== undefined && prior.text === msg.text) return

  cacheObservedIncomingMessage(msg, auth)
  applyEditToHistory(auth.storageContextId, msg.messageId, msg.text)

  const activeRun = runRegistry.get(auth.storageContextId)
  const lastTurn = lastTurnRegistry.get(auth.storageContextId)
  const beforeTs = prior?.timestamp ?? 0
  const later = laterUserMessageExists(auth.storageContextId, beforeTs)
  const window = classifyEdit({
    editedMessageId: msg.messageId,
    activeRun,
    lastTurn,
    laterUserMessageExists: later,
  })

  log.debug({ storageContextId: auth.storageContextId, messageId: msg.messageId, window }, 'Edit classified')

  if (window === 'w1' && activeRun !== undefined) {
    activeRun.steerQueue.push({ text: `⟲ Your earlier message was edited. New version:\n\n${msg.text}` })
    await reply.text('✋ folding that into the current run…')
    return
  }
  if (window === 'w2' && lastTurn !== undefined) {
    await handleW2(chat, msg, reply, auth, lastTurn, deps)
  }
  // w3: baseline-only (history + metadata already corrected above).
}

/**
 * W2 rerun pathway. When the just-completed turn owned the edited message and
 * no later user turn has arrived, the baseline-corrected history is what the
 * assistant *should* have answered against, so a fresh turn is derived from it.
 *
 * - **No side-effects branch (Task 10):** the prior turn only produced chat
 *   text, so regenerating is safe. Kick `processMessage` with the edited text
 *   (the orchestrator reads the already-corrected history), then mark the old
 *   reply as superseded via `editReply` so the user sees the replacement
 *   portably — v1 posts a NEW reply rather than rewriting the old answer in
 *   place, which would require an orchestrator refactor.
 * - **Side-effects branch (Task 11):** the prior turn mutated external state
 *   (created tasks, etc.), so silent regeneration is unsafe. Stubbed here.
 */
async function handleW2(
  _chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
): Promise<void> {
  if (last.completedEffects.length > 0) {
    // Side-effects branch — implemented in Task 11.
    return
  }
  if (deps.processMessage === undefined) {
    log.warn(
      { storageContextId: auth.storageContextId, messageId: msg.messageId },
      'W2 regeneration requested but processMessage is not wired into deps; skipping',
    )
    return
  }
  // Build the orchestrator deps exactly like `processCoalescedMessage`: spread
  // the production defaults, then thread the bot-level optional DI if present.
  const orchestratorDeps = {
    ...defaultDeps,
    ...(deps.stagedDownloadFn === undefined ? {} : { stagedDownloadFn: deps.stagedDownloadFn }),
    ...(deps.chatParticipantResolver === undefined ? {} : { chatParticipantResolver: deps.chatParticipantResolver }),
  }
  // No side-effects: regenerate from the (already-corrected) history. A fresh
  // turnId is generated by the orchestrator since we pass `undefined`.
  await deps.processMessage(
    reply,
    auth.storageContextId,
    msg.user.id,
    msg.user.username,
    msg.text,
    msg.contextType,
    auth.configContextId,
    orchestratorDeps,
    [],
    undefined,
    auth.isGuest === true ? 'guest' : 'member',
  )
  // Supersede the old reply. Best-effort: an edit failure must never crash the
  // regeneration pathway. Only fires when both the platform exposes
  // `editReply` and the prior turn captured a `replyTarget`.
  if (reply.editReply !== undefined && last.replyTarget !== undefined) {
    await reply.editReply(last.replyTarget, '⟲ Superseded by your edit.').catch((): undefined => undefined)
  }
}
