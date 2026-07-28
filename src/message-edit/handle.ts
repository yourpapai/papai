// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, gt } from 'drizzle-orm'

import { resolveMessageAuth, shouldIgnoreGroupMessage } from '../bot-guards.js'
import { cacheObservedIncomingMessage } from '../bot-message-caching.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn } from '../chat/types.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { applyEditToHistory } from '../history.js'
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

export type EditHandlerDeps = { processMessage?: (...args: never[]) => Promise<void> } & Record<string, unknown>

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
  deps: { processMessage?: (...args: never[]) => Promise<void> } & Record<string, unknown>,
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
    // Implemented in Tasks 10–11.
    await handleW2(chat, msg, reply, auth, lastTurn, deps)
  }
  // w3: baseline-only (history + metadata already corrected above).
}

/** W2 rerun pathway — replaced in Task 10. */
async function handleW2(
  _chat: ChatProvider,
  _msg: IncomingMessage,
  _reply: ReplyFn,
  _auth: AuthorizationResult,
  _last: LastTurn,
  _deps: EditHandlerDeps,
): Promise<void> {
  // noop until Tasks 10–11
}
