// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigValue, setConfigValue, unsetConfigValue } from '../config.js'
import { t, isSupportedLocale, type Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { peekEditPrompt, resolveEditPrompt } from '../message-edit/edit-prompt-store.js'
import { getContextLanguage } from '../utils/config-language.js'
import {
  formatDecisionConfirmation,
  peekPermissionRequest,
  resolvePermissionRequest,
  type PermissionDecision,
} from './permission-prompt.js'
import type { AuthorizationResult, IncomingInteraction, PromptHandle, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })
const PERMISSION_CALLBACK_PATTERN = /^perm:(a|d):([A-Za-z0-9_-]+)$/u
const EDIT_CALLBACK_PATTERN = /^edit:(adjust|note):([A-Za-z0-9_-]+)$/u
const LANGUAGE_CALLBACK_PATTERN = /^lang:([a-z]{2})$/u

const permissionDecisionFromCode = (code: string): PermissionDecision => (code === 'a' ? 'allow' : 'deny')

const localeOf = (auth: AuthorizationResult): Locale =>
  getContextLanguage(auth.configContextId ?? auth.storageContextId)

async function finalizePermissionDecision(
  reply: ReplyFn,
  toolName: string,
  sourceMessageText: string | undefined,
  decision: PermissionDecision,
  handle: PromptHandle | undefined,
  locale: Locale,
): Promise<void> {
  const confirmation = formatDecisionConfirmation(toolName, decision, locale)
  // Ephemeral path: delete the prompt, confirm with a non-persistent toast.
  if (reply.ephemeralConfirm !== undefined && handle !== undefined) {
    try {
      await handle.remove()
    } catch (error) {
      log.warn({ toolName, error: error instanceof Error ? error.message : String(error) }, 'Failed to remove prompt')
    }
    await reply.ephemeralConfirm(confirmation)
    return
  }
  // Fallback: edit the prompt in place (current behavior), now with the tool name.
  const content = sourceMessageText === undefined ? confirmation : `${sourceMessageText.trimEnd()}\n\n${confirmation}`
  if (reply.replaceText !== undefined) {
    try {
      await reply.replaceText(content)
      return
    } catch {
      await reply.text(content)
      return
    }
  }
  await reply.text(content)
}

/**
 * Handle a `lang:<locale>` picker-callback: persist the language on the config
 * context and clear `language_prompted`. Guests (never offered the picker, see
 * `postLanguagePicker`), invalid locales and locales equal to the
 * already-stored language are consumed no-ops; the ack is localized to the
 * newly selected locale.
 */
async function handleLanguageCallback(reply: ReplyFn, auth: AuthorizationResult, locale: string): Promise<boolean> {
  if (auth.isGuest === true) return true
  if (!isSupportedLocale(locale)) return true
  const configContextId = auth.configContextId ?? auth.storageContextId
  const stored = getConfigValue(configContextId, 'language')
  if (stored !== null && isSupportedLocale(stored) && stored === locale) return true

  setConfigValue(configContextId, 'language', locale)
  unsetConfigValue(configContextId, 'language_prompted')
  log.info({ configContextId, locale }, 'Language preference saved from picker callback')
  await reply.text(t('picker.saved', locale))
  return true
}

/** Handle a `perm:a:`/`perm:d:` allow/deny decision for an `ask`-gated tool. */
async function handlePermissionCallback(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
  code: string,
  id: string,
): Promise<boolean> {
  const decision = permissionDecisionFromCode(code)
  const locale = localeOf(auth)
  const pending = peekPermissionRequest(id)
  if (pending === null || pending.contextId !== auth.storageContextId) {
    await reply.text(t('interactions.staleAction', locale))
    return true
  }
  const result = resolvePermissionRequest(id, decision)
  if (!result.resolved) {
    await reply.text(t('interactions.staleAction', locale))
    return true
  }
  await finalizePermissionDecision(
    reply,
    pending.toolName,
    interaction.sourceMessageText,
    decision,
    result.handle,
    locale,
  )
  return true
}

/** Handle an `edit:adjust:`/`edit:note:` W2 side-effects decision. */
async function handleEditCallback(
  reply: ReplyFn,
  auth: AuthorizationResult,
  action: string,
  id: string,
): Promise<boolean> {
  const prompt = peekEditPrompt(id)
  if (prompt === undefined || prompt.contextId !== auth.storageContextId) {
    await reply.text(t('interactions.staleAction', localeOf(auth)))
    return true
  }
  const resolved = resolveEditPrompt(id)
  if (resolved === undefined) {
    await reply.text(t('interactions.staleAction', localeOf(auth)))
    return true
  }
  if (action === 'adjust') await resolved.onAdjust()
  else await resolved.onNote()
  return true
}

/**
 * The config-flow callbacks were retired with the move to the settings web UI.
 * This router authorizes the actor and handles three prefixes:
 *  - `perm:a:`/`perm:d:` — the allow/deny decision for an `ask`-gated tool
 *    prompt (see `handlePermissionCallback`).
 *  - `edit:adjust:`/`edit:note:` — the W2 side-effects "ask-first" buttons
 *    posted by `src/message-edit/handle.ts` when an edit targets a just-finished
 *    turn that made side-effects. `adjust` triggers a corrective regen +
 *    supersede; `note` leaves the (already baseline-corrected) history alone.
 *  - `lang:<locale>` — the first-interaction language picker (see
 *    `handleLanguageCallback`).
 * Any other callback is a safe-sink no-op, so adapters that still emit
 * interaction events have a single, harmless entry point.
 */
export async function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean> {
  if (!auth.allowed) {
    await reply.text('You are not authorized to use this bot.')
    return true
  }

  const languageMatch = LANGUAGE_CALLBACK_PATTERN.exec(interaction.callbackData)
  if (languageMatch !== null) {
    return handleLanguageCallback(reply, auth, languageMatch[1]!)
  }

  const permissionMatch = PERMISSION_CALLBACK_PATTERN.exec(interaction.callbackData)
  if (permissionMatch !== null) {
    return handlePermissionCallback(interaction, reply, auth, permissionMatch[1]!, permissionMatch[2]!)
  }

  const editMatch = EDIT_CALLBACK_PATTERN.exec(interaction.callbackData)
  if (editMatch !== null) {
    return handleEditCallback(reply, auth, editMatch[1]!, editMatch[2]!)
  }

  log.debug({ callbackData: interaction.callbackData }, 'No route matched for interaction callback')
  return false
}
