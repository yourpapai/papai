// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../logger.js'
import { kvGet, kvSet } from '../plugins/store.js'
import { resolveMagiPermission } from './magi-permission-client.js'
import {
  formatDecisionConfirmation,
  peekPermissionRequest,
  resolvePermissionRequest,
  type PermissionDecision,
} from './permission-prompt.js'
import { getConfigContextIdFromStorageContextId } from './scoped-context.js'
import type { AuthorizationResult, IncomingInteraction, PromptHandle, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })
const PERMISSION_CALLBACK_PATTERN = /^perm:(a|d):([A-Za-z0-9_-]+)$/u
const MAGI_PERMISSION_CALLBACK_PATTERN = /^mperm:(a|d):([A-Za-z0-9_-]+)$/u
const PERMISSION_KV_PLUGIN_ID = 'nerv-magi-permission'

const magiPermissionKvEntrySchema = z.object({ sessionId: z.string(), toolCallId: z.string() })

const permissionDecisionFromCode = (code: string): PermissionDecision => (code === 'a' ? 'allow' : 'deny')

interface RouteDeps {
  resolveMagiPermission: typeof resolveMagiPermission
}

// Shared by both permission-decision routes: prefer editing the prompt in place, falling back to
// a plain text reply when the platform has no replaceText or the edit itself fails.
async function replaceOrSendText(reply: ReplyFn, content: string): Promise<void> {
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

type MagiPermissionKvValue =
  | { kind: 'malformed' }
  | { kind: 'invalid' }
  | { kind: 'ok'; entry: { sessionId: string; toolCallId: string } }

// A malformed (non-JSON) kv value is treated the same as a missing entry: JSON.parse must never
// throw out of this handler, per the router's "never throws" contract.
function parseMagiPermissionKvValue(raw: string): MagiPermissionKvValue {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return { kind: 'malformed' }
  }
  const parsedEntry = magiPermissionKvEntrySchema.safeParse(parsedJson)
  if (!parsedEntry.success) return { kind: 'invalid' }
  return { kind: 'ok', entry: parsedEntry.data }
}

async function routeMagiPermission(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
  code: string,
  cbid: string,
  deps: RouteDeps,
): Promise<void> {
  const decision = permissionDecisionFromCode(code)
  // This ask is authorized at config-context (channel/DM) granularity by design: papai's
  // checkAuthorizationExtended gate is already channel-wide, and cbid is high-entropy and
  // only ever exposed inside the HMAC-signed button, so config-context keying is sufficient
  // (exact thread-level storageContextId comparison could false-reject valid clicks whose
  // notify- vs click-derived id formats differ).
  const configContextId = getConfigContextIdFromStorageContextId(auth.storageContextId)
  const raw = kvGet(PERMISSION_KV_PLUGIN_ID, configContextId, cbid)
  if (raw === undefined || raw === '') {
    await reply.text('Action is no longer available.')
    return
  }
  const parsed = parseMagiPermissionKvValue(raw)
  if (parsed.kind === 'malformed') {
    await reply.text('This request is no longer available.')
    return
  }
  // Tombstone before the magi POST so a double-click (or a retry) can never resolve the same ask twice.
  kvSet(PERMISSION_KV_PLUGIN_ID, configContextId, cbid, '')
  if (parsed.kind === 'invalid') {
    await reply.text('This request is no longer available.')
    return
  }
  const { entry } = parsed
  const ok = await deps.resolveMagiPermission(entry.sessionId, entry.toolCallId, decision)
  if (!ok) {
    // The magi POST failed (network/restart/5xx), not the user's decision being invalid.
    // Restore the entry so a retried click within the HMAC TTL can still resolve the ask,
    // and leave the prompt buttons intact instead of redacting them.
    kvSet(PERMISSION_KV_PLUGIN_ID, configContextId, cbid, raw)
    await reply.text('Could not reach the approval service — please tap Allow or Deny again.')
    return
  }
  const confirmation = formatDecisionConfirmation('the request', decision)
  const src = interaction.sourceMessageText
  const content = src === undefined ? confirmation : `${src.trimEnd()}\n\n${confirmation}`
  await replaceOrSendText(reply, content)
}

async function finalizePermissionDecision(
  reply: ReplyFn,
  toolName: string,
  sourceMessageText: string | undefined,
  decision: PermissionDecision,
  handle: PromptHandle | undefined,
): Promise<void> {
  const confirmation = formatDecisionConfirmation(toolName, decision)
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
 * The config-flow callbacks were retired with the move to the settings web UI.
 * This router authorizes the actor and handles two prefixes: `perm:a:`/`perm:d:`, the
 * allow/deny decision for an `ask`-gated tool prompt (see `finalizePermissionDecision`),
 * and `mperm:a:`/`mperm:d:`, the allow/deny decision for a magi-originated permission
 * ask surfaced via buttons (see `routeMagiPermission`). Any other callback is a
 * safe-sink no-op, so adapters that still emit interaction events have a single,
 * harmless entry point.
 */
export async function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: RouteDeps = { resolveMagiPermission },
): Promise<boolean> {
  if (!auth.allowed) {
    await reply.text('You are not authorized to use this bot.')
    return true
  }

  const permissionMatch = PERMISSION_CALLBACK_PATTERN.exec(interaction.callbackData)
  if (permissionMatch !== null) {
    const decision = permissionDecisionFromCode(permissionMatch[1]!)
    const id = permissionMatch[2]!
    const pending = peekPermissionRequest(id)
    if (pending === null || pending.contextId !== auth.storageContextId) {
      await reply.text('Action is no longer available.')
      return true
    }
    const result = resolvePermissionRequest(id, decision)
    if (!result.resolved) {
      await reply.text('Action is no longer available.')
      return true
    }
    await finalizePermissionDecision(reply, pending.toolName, interaction.sourceMessageText, decision, result.handle)
    return true
  }

  const magiMatch = MAGI_PERMISSION_CALLBACK_PATTERN.exec(interaction.callbackData)
  if (magiMatch !== null) {
    await routeMagiPermission(interaction, reply, auth, magiMatch[1]!, magiMatch[2]!, deps)
    return true
  }

  log.debug({ callbackData: interaction.callbackData }, 'No route matched for interaction callback')
  return false
}
