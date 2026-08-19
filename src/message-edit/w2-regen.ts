// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import type { AuthorizedTurnSeed } from '../analytics/bot-observer.js'
import { buildEditSeed, observeEditRegen, type EditRegenPhase } from '../analytics/edit-observer.js'
import type { AnalyticsObserver } from '../analytics/runtime.js'
import type { AuthorizationResult, IncomingMessage, PromptHandle, ReplyFn } from '../chat/types.js'
import { trimTurnForRegeneration } from '../history.js'
import { t, type Locale } from '../i18n/index.js'
import type { LlmOrchestratorDeps } from '../llm-orchestrator-types.js'
import { defaultDeps } from '../llm-orchestrator.js'
import { logger } from '../logger.js'
import type { LastTurn } from '../run-control/last-turn-registry.js'
import { buildStopSummary } from '../run-control/summary.js'
import { getContextLanguage } from '../utils/config-language.js'
import { registerEditPrompt, type PendingEditPrompt } from './edit-prompt-store.js'
import type { EditHandlerDeps } from './handle.js'

const log = logger.child({ scope: 'message-edit:w2-regen' })

type EditFunnel = {
  observer: AnalyticsObserver | undefined
  editSeed: AuthorizedTurnSeed | undefined
}

function resolveEditFunnel(deps: EditHandlerDeps, msg: IncomingMessage, auth: AuthorizationResult): EditFunnel {
  const observer = deps.analyticsObserver
  const editSeed = observer === undefined ? undefined : buildEditSeed(msg, auth)
  return { observer, editSeed }
}

function emitEditRegen(funnel: EditFunnel, phase: EditRegenPhase, durationMs?: number): void {
  if (funnel.observer !== undefined && funnel.editSeed !== undefined) {
    observeEditRegen(funnel.observer, funnel.editSeed, phase, durationMs)
  }
}

function buildOrchestratorDeps(deps: EditHandlerDeps): LlmOrchestratorDeps {
  return {
    ...defaultDeps,
    ...(deps.stagedDownloadFn === undefined ? {} : { stagedDownloadFn: deps.stagedDownloadFn }),
    ...(deps.chatParticipantResolver === undefined ? {} : { chatParticipantResolver: deps.chatParticipantResolver }),
  }
}

async function supersedePriorReply(reply: ReplyFn, last: LastTurn): Promise<void> {
  if (reply.editReply !== undefined && last.replyTarget !== undefined) {
    await reply.editReply(last.replyTarget, '⟲ Superseded by your edit.').catch((): undefined => undefined)
  }
}

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
    emitEditRegen(resolveEditFunnel(deps, msg, auth), 'history_only')
    return
  }
  // `applyEditToHistory` (run in `onIncomingEdit`) rewrote the originating user
  // turn in place; drop that rewritten turn + its trailing assistant/tool
  // messages so `processMessage` re-creates the turn fresh instead of appending
  // a duplicate user message onto the stale reply. W1/W3 are unaffected: this
  // only runs in the regen path.
  if (msg.messageId !== undefined) {
    trimTurnForRegeneration(auth.storageContextId, msg.messageId)
  }
  const funnel = resolveEditFunnel(deps, msg, auth)
  const startedMonotonicMs = performance.now()
  emitEditRegen(funnel, 'regen_started')
  try {
    await processMessage(
      reply,
      auth.storageContextId,
      msg.user.id,
      msg.user.username,
      msg.text,
      msg.contextType,
      auth.configContextId,
      buildOrchestratorDeps(deps),
      [],
      undefined,
      auth.isGuest === true ? 'guest' : 'member',
    )
  } catch (error) {
    emitEditRegen(funnel, 'regen_failed', Math.max(0, Math.round(performance.now() - startedMonotonicMs)))
    throw error
  }
  await supersedePriorReply(reply, last)
  emitEditRegen(funnel, 'regen_completed', Math.max(0, Math.round(performance.now() - startedMonotonicMs)))
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
  const locale = getContextLanguage(auth.configContextId ?? auth.storageContextId)
  const promptText = buildSideEffectsPromptText(last.completedEffects, msg.text, locale)
  registerEditPrompt(promptId, buildEditPromptHandlers(msg, reply, auth, last, deps, locale))
  const handle = await postSideEffectsPrompt(reply, auth, msg, promptText, promptId, locale)
  const funnel = resolveEditFunnel(deps, msg, auth)
  if (handle === undefined) {
    log.debug(
      { storageContextId: auth.storageContextId, messageId: msg.messageId },
      'Platform has no buttons for the W2 side-effects prompt; edit left as history-only',
    )
    emitEditRegen(funnel, 'history_only')
    return
  }
  emitEditRegen(funnel, 'prompt_shown')
}

function buildSideEffectsPromptText(effects: LastTurn['completedEffects'], editedText: string, locale: Locale): string {
  const summary = buildStopSummary(effects, { forced: false, locale })
  return `${summary}\n${t('messageEdit.promptEditLine', locale, { editedText })}\n[${t('messageEdit.adjustButton', locale)}] / [${t('messageEdit.noteButton', locale)}]`
}

function buildEditPromptHandlers(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
  locale: Locale,
): PendingEditPrompt {
  return {
    contextId: auth.storageContextId,
    editedText: msg.text,
    onAdjust: async (): Promise<void> => {
      emitEditRegen(resolveEditFunnel(deps, msg, auth), 'prompt_adjust')
      await sendEphemeralAck(reply, auth, t('messageEdit.adjustingAck', locale))
      await regenerateFromEditedText(msg, reply, auth, last, deps)
    },
    onNote: async (): Promise<void> => {
      emitEditRegen(resolveEditFunnel(deps, msg, auth), 'prompt_note')
      await sendEphemeralAck(reply, auth, t('messageEdit.notedAck', locale))
    },
  }
}

function postSideEffectsPrompt(
  reply: ReplyFn,
  auth: AuthorizationResult,
  msg: IncomingMessage,
  promptText: string,
  promptId: string,
  locale: Locale,
): Promise<PromptHandle | undefined> {
  return reply
    .buttons(promptText, {
      buttons: [
        {
          text: t('messageEdit.adjustButton', locale),
          callbackData: `edit:adjust:${promptId}`,
        },
        {
          text: t('messageEdit.noteButton', locale),
          callbackData: `edit:note:${promptId}`,
        },
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
      {
        storageContextId: auth.storageContextId,
        error: error instanceof Error ? error.message : String(error),
      },
      'ephemeral ack failed',
    )
  })
}
