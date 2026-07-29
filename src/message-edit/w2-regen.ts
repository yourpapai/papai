// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import type { AuthorizationResult, IncomingMessage, PromptHandle, ReplyFn } from '../chat/types.js'
import { trimTurnForRegeneration } from '../history.js'
import { defaultDeps } from '../llm-orchestrator.js'
import { logger } from '../logger.js'
import type { LastTurn } from '../run-control/last-turn-registry.js'
import { buildStopSummary } from '../run-control/summary.js'
import { registerEditPrompt, type PendingEditPrompt } from './edit-prompt-store.js'
import type { EditHandlerDeps } from './handle.js'

const log = logger.child({ scope: 'message-edit:w2-regen' })

/**
 * Shared corrective-regen path used by both the no-side-effects branch
 * (immediate) and the side-effects `Adjust for me` button (deferred). Builds
 * the orchestrator deps exactly like `processCoalescedMessage`: spread the
 * production defaults, then thread the bot-level optional DI if present. Kicks
 * a fresh turn derived from the already-corrected history (the orchestrator
 * generates a new `turnId` since we pass `undefined`), and best-effort
 * supersedes the prior reply via `editReply` (only fires when both the platform
 * exposes `editReply` and the prior turn captured a `replyTarget`).
 */
export async function regenerateFromEditedText(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
): Promise<void> {
  const processMessage = deps.processMessage
  if (processMessage === undefined) {
    log.warn(
      { storageContextId: auth.storageContextId, messageId: msg.messageId },
      'W2 regeneration requested but processMessage is not wired into deps; skipping',
    )
    return
  }
  const orchestratorDeps = {
    ...defaultDeps,
    ...(deps.stagedDownloadFn === undefined ? {} : { stagedDownloadFn: deps.stagedDownloadFn }),
    ...(deps.chatParticipantResolver === undefined ? {} : { chatParticipantResolver: deps.chatParticipantResolver }),
  }
  // `applyEditToHistory` (run in `onIncomingEdit`) rewrote the originating user
  // turn in place; drop that rewritten turn + its trailing assistant/tool
  // messages so `processMessage` re-creates the turn fresh instead of appending
  // a duplicate user message onto the stale reply. W1/W3 are unaffected: this
  // only runs in the regen path.
  if (msg.messageId !== undefined) {
    trimTurnForRegeneration(auth.storageContextId, msg.messageId)
  }
  await processMessage(
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
  if (reply.editReply !== undefined && last.replyTarget !== undefined) {
    await reply.editReply(last.replyTarget, '⟲ Superseded by your edit.').catch((): undefined => undefined)
  }
}

/**
 * Side-effects branch: the prior turn mutated external state, so we must not
 * silently regenerate. Post an "ask-first" button prompt summarizing what the
 * turn already did + the edited text. The user picks `Adjust for me` (corrective
 * regen + supersede, same as the no-side-effects branch) or `Just note it`
 * (history-only — already done — + ephemeral ack). On platforms without buttons
 * (Kontur Talk) the edit is left as history-only.
 */
export async function handleW2WithSideEffects(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
): Promise<void> {
  const promptId = randomUUID()
  const promptText = buildSideEffectsPromptText(last.completedEffects, msg.text)
  registerEditPrompt(promptId, buildEditPromptHandlers(msg, reply, auth, last, deps))
  const handle = await postSideEffectsPrompt(reply, auth, msg, promptText, promptId)
  if (handle === undefined) {
    log.debug(
      { storageContextId: auth.storageContextId, messageId: msg.messageId },
      'Platform has no buttons for the W2 side-effects prompt; edit left as history-only',
    )
  }
}

function buildSideEffectsPromptText(effects: LastTurn['completedEffects'], editedText: string): string {
  const summary = buildStopSummary(effects, { forced: false })
  return `${summary}\nYour edit: "${editedText}".\n[Adjust for me] / [Just note it]`
}

function buildEditPromptHandlers(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
): PendingEditPrompt {
  return {
    contextId: auth.storageContextId,
    editedText: msg.text,
    onAdjust: async (): Promise<void> => {
      await sendEphemeralAck(reply, auth, '✏️ Adjusting…')
      await regenerateFromEditedText(msg, reply, auth, last, deps)
    },
    onNote: async (): Promise<void> => {
      await sendEphemeralAck(reply, auth, '✏️ Noted')
    },
  }
}

function postSideEffectsPrompt(
  reply: ReplyFn,
  auth: AuthorizationResult,
  msg: IncomingMessage,
  promptText: string,
  promptId: string,
): Promise<PromptHandle | undefined> {
  return reply
    .buttons(promptText, {
      buttons: [
        { text: 'Adjust for me', callbackData: `edit:adjust:${promptId}` },
        { text: 'Just note it', callbackData: `edit:note:${promptId}` },
      ],
    })
    .catch((error: unknown) => {
      log.warn(
        {
          storageContextId: auth.storageContextId,
          messageId: msg.messageId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to post W2 side-effects edit prompt; leaving the edit as history-only',
      )
      return undefined
    })
}

async function sendEphemeralAck(reply: ReplyFn, auth: AuthorizationResult, text: string): Promise<void> {
  await reply.ephemeralConfirm?.(text).catch((error: unknown) => {
    log.debug(
      { storageContextId: auth.storageContextId, error: error instanceof Error ? error.message : String(error) },
      'ephemeral ack failed',
    )
  })
}
