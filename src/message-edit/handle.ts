// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { performance } from 'node:perf_hooks'

import { and, eq, gt, ne } from 'drizzle-orm'

import { buildAnalyticsSourceContext, createAuthorizedTurnSeed } from '../analytics/bot-observer.js'
import type { AuthorizedTurnSeed } from '../analytics/bot-observer.js'
import { buildEditSeed, observeEditClassified, observeEditRegen } from '../analytics/edit-observer.js'
import type { AnalyticsObserver } from '../analytics/runtime.js'
import { buildTurnSteeredFact, nextSteerOrdinal } from '../analytics/turn-observer.js'
import type { StagedFileDownloadFn } from '../attachments/index.js'
import { resolveMessageAuth, shouldIgnoreGroupMessage } from '../bot-guards.js'
import { cacheObservedIncomingMessage } from '../bot-message-caching.js'
import type { ChatParticipantResolver } from '../chat/participants/roster.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn } from '../chat/types.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { applyEditToHistory } from '../history.js'
import type { ProcessMessageFn } from '../llm-orchestrator-process-args.js'
import { logger } from '../logger.js'
import { getMessageByContext } from '../message-cache/index.js'
import { lastTurnRegistry, type LastTurn } from '../run-control/last-turn-registry.js'
import { runRegistry } from '../run-control/registry.js'
import type { RunControl } from '../run-control/types.js'
import { classifyEdit } from './classify.js'
import type { EditWindow } from './classify.js'
import { handleW2WithSideEffects, regenerateFromEditedText } from './w2-regen.js'

const log = logger.child({ scope: 'message-edit' })

/**
 * Determine whether any user-authored message was observed in `contextId`
 * strictly after `beforeTimestamp`. Backs the W2-vs-W3 decision: a later user
 * turn means the edited message is no longer the "last" one and a W2 rerun
 * would only re-derive a stale reply.
 *
 * `editedId` is excluded explicitly so the query is correct by construction
 * regardless of write-ordering: the just-upserted edited row never counts as a
 * "later user message" (which would silently flip every W2 to W3). Without this,
 * the call site relies on `cacheObservedIncomingMessage`'s microtask-deferred
 * upsert not having flushed before the query — a single `await` would break it.
 */
function laterUserMessageExists(contextId: string, beforeTimestamp: number, editedId: string): boolean {
  const row = getDrizzleDb()
    .select({ messageId: messageMetadata.messageId })
    .from(messageMetadata)
    .where(
      and(
        eq(messageMetadata.contextId, contextId),
        gt(messageMetadata.timestamp, beforeTimestamp),
        ne(messageMetadata.messageId, editedId),
      ),
    )
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
  /** Optional analytics observer for the W1 edit-steer boundary, mirroring `BotDeps`. */
  analyticsObserver?: AnalyticsObserver
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
  const later = laterUserMessageExists(auth.storageContextId, beforeTs, msg.messageId)
  const window = classifyEdit({
    editedMessageId: msg.messageId,
    activeRun,
    lastTurn,
    laterUserMessageExists: later,
  })

  const editSeed = observeEditClassification(deps, msg, auth, window)

  log.debug(
    {
      storageContextId: auth.storageContextId,
      messageId: msg.messageId,
      window,
    },
    'Edit classified',
  )

  if (window === 'w1' && activeRun !== undefined) {
    await pushW1SteerAndAck(activeRun, msg, reply, auth, deps)
    return
  }
  if (window === 'w2' && lastTurn !== undefined) {
    await handleW2(chat, msg, reply, auth, lastTurn, deps, editSeed)
  }
  // w3: baseline-only (history + metadata already corrected above).
}

/**
 * Builds the edit analytics seed at the classification boundary and emits the
 * `edit_classified` fact (window only). Returns the seed so the W2 path can
 * reuse it for its regen-funnel emissions without rebuilding the source.
 * No observer or unknown platform instance → returns undefined (silent).
 */
function observeEditClassification(
  deps: EditHandlerDeps,
  msg: IncomingMessage,
  auth: AuthorizationResult,
  window: EditWindow,
): AuthorizedTurnSeed | undefined {
  const observer = deps.analyticsObserver
  if (observer === undefined) return undefined
  const editSeed = buildEditSeed(msg, auth)
  if (editSeed === undefined) return undefined
  observeEditClassified(observer, editSeed, window)
  return editSeed
}

/**
 * W1 dispatch: inject the edited text into the live run's `steerQueue` (the
 * orchestrator picks it up at the next tool-step boundary) and ack the user.
 * An edit-steer is the same mid-run steering boundary as a manual steer, so it
 * emits the same `turn_steered` fact; the edit itself is a correction, not a
 * newly accepted message, so no accepted/turn facts are produced here.
 */
async function pushW1SteerAndAck(
  run: RunControl,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: EditHandlerDeps,
): Promise<void> {
  const steerText = `⟲ Your earlier message was edited. New version:\n\n${msg.text}`
  run.steerQueue.push({ text: steerText })
  await reply.text('✋ folding that into the current run…')
  const observer = deps.analyticsObserver
  if (observer === undefined) return
  const source = buildAnalyticsSourceContext(msg, auth, 'normal', null)
  if (source === null) return
  const seed = createAuthorizedTurnSeed(source, msg, 0, {
    nowMs: () => Date.now(),
    nowMonotonicMs: () => performance.now(),
  })
  observer.observe(
    buildTurnSteeredFact(
      { ...seed.source, rawTurnId: run.turnId },
      {
        sourceEventId: `${seed.sourceEventId}:steered`,
        ordinal: nextSteerOrdinal(run),
        steerLengthChars: steerText.length,
        ackSent: true,
      },
    ),
  )
}

/**
 * W2 rerun pathway. When the just-completed turn owned the edited message and
 * no later user turn has arrived, the baseline-corrected history is what the
 * assistant *should* have answered against, so a fresh turn is derived from it.
 *
 * - **No side-effects branch (Task 10):** the prior turn only produced chat
 *   text, so regenerating is safe — call `regenerateFromEditedText` immediately.
 * - **Side-effects branch (Task 11):** the prior turn mutated external state
 *   (created tasks, etc.), so silent regeneration is unsafe — defer to
 *   `handleW2WithSideEffects`, which posts an ask-first button prompt.
 */
async function handleW2(
  _chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
  editSeed: AuthorizedTurnSeed | undefined,
): Promise<void> {
  if (last.completedEffects.length > 0) {
    await handleW2WithSideEffects(msg, reply, auth, last, deps)
    return
  }
  if (deps.processMessage === undefined) {
    log.warn(
      { storageContextId: auth.storageContextId, messageId: msg.messageId },
      'W2 regeneration requested but processMessage is not wired into deps; skipping',
    )
    const observer = deps.analyticsObserver
    if (observer !== undefined && editSeed !== undefined) observeEditRegen(observer, editSeed, 'history_only')
    return
  }
  await regenerateFromEditedText(msg, reply, auth, last, deps)
}
