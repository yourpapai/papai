// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import type { AuthorizationResult, IncomingMessage } from '../chat/types.js'
import { getContextSettings } from '../instances/context-store.js'
import { getPlatformInstance } from '../instances/platform-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import type { AnalyticsSourceContext, AuthCheckedFact, ChatMessageAcceptedFact } from './source-facts.js'

/**
 * Immutable in-memory turn seed created once at the authorized message boundary.
 * `sourceEventId` is generated here and is only ever HMACed (Task 3 identity)
 * before durable storage; it is never written raw.
 */
export type AuthorizedTurnSeed = Readonly<{
  sourceEventId: string
  acceptedAtMs: number
  acceptedAtMonotonicMs: number
  source: AnalyticsSourceContext
  inputCount: number
  inputLength: number
  attachmentCount: number
}>

type AnalyticsActorRole = AnalyticsSourceContext['actorRole']
type TaskProvider = AnalyticsSourceContext['taskProvider']
type InvocationMode = AnalyticsSourceContext['invocationMode']

/** Maps the auth result to the analytics actor role (kept separate from the tool-execution `ActorRole` union). */
export function analyticsActorRole(auth: AuthorizationResult): AnalyticsActorRole {
  if (auth.isBotAdmin || auth.isGroupAdmin) return 'admin'
  if (auth.isGuest === true) return 'guest'
  return 'member'
}

function taskProviderOf(taskInstanceId: string | null): TaskProvider {
  if (taskInstanceId === null) return 'none'
  const type = getTaskInstance(taskInstanceId)?.type
  if (type === 'kaneo') return 'kaneo'
  if (type === 'youtrack') return 'youtrack'
  return 'other'
}

/**
 * Authoritative source context resolved at the message boundary (post-auth).
 * Returns null when the platform instance is unknown; callers skip analytics.
 */
export function buildAnalyticsSourceContext(
  msg: IncomingMessage,
  auth: AuthorizationResult,
  invocationMode: InvocationMode,
  rawTurnId: string | null,
): AnalyticsSourceContext | null {
  const instance = getPlatformInstance(msg.platformInstanceId)
  if (instance === null) return null
  const configContextId = auth.configContextId ?? auth.storageContextId
  const taskInstanceId = getContextSettings(configContextId)?.taskInstanceId ?? null
  return {
    platform: instance.type,
    platformInstanceId: msg.platformInstanceId,
    chatUserId: msg.user.id,
    nativeContextId: msg.contextId,
    storageContextId: auth.storageContextId,
    configContextId,
    contextType: msg.contextType,
    actorRole: analyticsActorRole(auth),
    taskInstanceId,
    taskProvider: taskProviderOf(taskInstanceId),
    invocationMode,
    rawTurnId,
  }
}

type AuthCheckedReason = AuthCheckedFact['reason']

function authCheckedReasonOf(auth: AuthorizationResult): AuthCheckedReason {
  if (auth.allowed) {
    if (auth.isBotAdmin) return 'admin'
    if (auth.isGuest === true) return 'guest_mode'
    return 'member'
  }
  if (auth.reason === 'user_blocked') return 'blocked'
  if (auth.reason === 'group_not_allowed' || auth.reason === 'group_member_not_allowed') return 'group_unauthorized'
  if (auth.reason === 'dm_not_allowed') return 'unknown_user'
  return 'other'
}

/** Bounded post-auth fact. Emitted for every authorization decision, granted or denied. */
export function buildAuthCheckedFact(source: AnalyticsSourceContext, auth: AuthorizationResult): AuthCheckedFact {
  return {
    version: 1,
    type: 'auth_checked',
    sourceEventId: randomUUID(),
    occurredAtMs: Date.now(),
    source,
    outcome: auth.allowed ? 'granted' : 'denied',
    reason: authCheckedReasonOf(auth),
  }
}

const KNOWN_COMMANDS: ReadonlySet<string> = new Set([
  'start',
  'config',
  'help',
  'context',
  'dashboard',
  'clear',
  'stop',
])

/** Maps a registered command name to the bounded analytics command enum. */
export function commandPropOf(commandName: string): ChatMessageAcceptedFact['command'] {
  if (commandName === 'start') return 'start'
  if (commandName === 'acp' || commandName.startsWith('plugin_acp')) return 'acp'
  if (commandName.length === 0) return 'none'
  if (KNOWN_COMMANDS.has(commandName)) return commandName
  return 'other'
}

export function buildChatMessageAcceptedFact(
  seed: AuthorizedTurnSeed,
  input: Readonly<{ isCommand: boolean; command: ChatMessageAcceptedFact['command'] }>,
): ChatMessageAcceptedFact {
  return {
    version: 1,
    type: 'chat_message_accepted',
    sourceEventId: seed.sourceEventId,
    occurredAtMs: seed.acceptedAtMs,
    source: seed.source,
    inputCount: seed.inputCount,
    inputLengthChars: seed.inputLength,
    attachmentCount: seed.attachmentCount,
    isCommand: input.isCommand,
    command: input.command,
  }
}

/** Creates the immutable per-message seed at the authorized boundary. */
export function createAuthorizedTurnSeed(
  source: AnalyticsSourceContext,
  msg: IncomingMessage,
  attachmentCount: number,
  clocks: Readonly<{ nowMs: () => number; nowMonotonicMs: () => number }>,
): AuthorizedTurnSeed {
  return {
    sourceEventId: randomUUID(),
    acceptedAtMs: clocks.nowMs(),
    acceptedAtMonotonicMs: clocks.nowMonotonicMs(),
    source,
    inputCount: 1,
    inputLength: msg.text.length,
    attachmentCount,
  }
}
