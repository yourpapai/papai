// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId, parseScopedContextId } from '../../chat/scoped-context.js'
import type { Pseudonym } from '../controlled-types.js'
import { createPseudonym } from './pseudonym.js'

export type IdentityInput = {
  key: Buffer | Uint8Array
  keyVersion: string
  platform: 'telegram' | 'mattermost' | 'discord' | 'kontur-talk'
  platformInstanceId: string
  storageContextId: string
  chatUserId: string
  actorRole: 'admin' | 'member' | 'guest' | 'system'
  rawTurnId: string
  taskInstanceId: string | null
  sessionStartMs: number | null
  firstEventId: string | null
}

export type IdentityKeys = {
  actor_key: Pseudonym | null
  context_key: Pseudonym | null
  thread_key: Pseudonym | null
  turn_key: Pseudonym | null
  task_instance_key: Pseudonym | null
  conversation_key: Pseudonym | null
  session_key: Pseudonym | null
}

const EMPTY_KEYS: IdentityKeys = {
  actor_key: null,
  context_key: null,
  thread_key: null,
  turn_key: null,
  task_instance_key: null,
  conversation_key: null,
  session_key: null,
}

function buildPseudonym(input: IdentityInput, domain: string, components: readonly string[]): Pseudonym | null {
  try {
    return createPseudonym({ key: input.key, keyVersion: input.keyVersion, domain, components })
  } catch {
    return null
  }
}

function buildActorKey(input: IdentityInput, platformInstanceId: string): Pseudonym | null {
  return buildPseudonym(input, 'actor:v1', [platformInstanceId, input.chatUserId])
}

function buildContextKey(input: IdentityInput, platformInstanceId: string, nativeContextId: string): Pseudonym | null {
  return buildPseudonym(input, 'context:v1', [platformInstanceId, nativeContextId])
}

function buildThreadKey(input: IdentityInput): Pseudonym | null {
  if (input.platform === 'discord') return null
  return buildPseudonym(input, 'thread:v1', [input.storageContextId])
}

function buildTaskInstanceKey(input: IdentityInput): Pseudonym | null {
  if (input.taskInstanceId === null) return null
  return buildPseudonym(input, 'task-instance:v1', [input.taskInstanceId])
}

function buildSessionKey(
  input: IdentityInput,
  actorKey: Pseudonym | null,
  conversationKey: Pseudonym | null,
): Pseudonym | null {
  if (actorKey === null) return null
  if (conversationKey === null) return null
  if (input.sessionStartMs === null) return null
  if (input.firstEventId === null) return null
  return buildPseudonym(input, 'session:v1', [
    actorKey,
    conversationKey,
    String(input.sessionStartMs),
    input.firstEventId,
  ])
}

function resolveNativeContextId(storageContextId: string): string {
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  const parsed = parseScopedContextId(configContextId)
  return parsed === null ? configContextId : parsed.nativeContextId
}

export function buildIdentityKeys(input: IdentityInput): IdentityKeys {
  if (input.actorRole === 'guest') return { ...EMPTY_KEYS }

  const scoped = parseScopedContextId(input.storageContextId)
  if (scoped === null) return { ...EMPTY_KEYS }

  const nativeContextId = resolveNativeContextId(input.storageContextId)
  const actor_key = buildActorKey(input, scoped.platformInstanceId)
  const context_key = buildContextKey(input, scoped.platformInstanceId, nativeContextId)
  const thread_key = buildThreadKey(input)
  const turn_key = buildPseudonym(input, 'turn:v1', [input.rawTurnId])
  const task_instance_key = buildTaskInstanceKey(input)
  const conversation_key = thread_key ?? context_key
  const session_key = buildSessionKey(input, actor_key, conversation_key)

  return {
    actor_key,
    context_key,
    thread_key,
    turn_key,
    task_instance_key,
    conversation_key,
    session_key,
  }
}
