// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getRuntimeChatRouter } from '../chat-router-runtime.js'

export type SettingsUserIdResolution =
  | { kind: 'id'; userId: string }
  | { kind: 'resolved'; userId: string }
  | { kind: 'unresolved'; username: string }

/**
 * Resolve a settings-route user input (numeric ID or @username) to a platform user ID.
 * Numeric input short-circuits; otherwise the chat router is consulted. When the
 * router is missing or cannot resolve (e.g. Telegram user @usernames, which the
 * Bot API cannot look up), the cleaned username is returned as `unresolved` so
 * callers can decide between a pending entry and an error.
 */
export async function resolveSettingsUserId(
  rawUserId: string,
  principal: Readonly<{ platformUserId: string; platformInstanceId: string }>,
): Promise<SettingsUserIdResolution> {
  const clean = rawUserId.startsWith('@') ? rawUserId.slice(1) : rawUserId
  if (/^\d+$/u.test(clean)) return { kind: 'id', userId: clean }
  const router = getRuntimeChatRouter()
  if (router === null) return { kind: 'unresolved', username: clean }
  const resolved = await router.resolveUserId(rawUserId, {
    contextId: principal.platformUserId,
    contextType: 'dm',
    platformInstanceId: principal.platformInstanceId,
  })
  if (resolved === null) return { kind: 'unresolved', username: clean }
  return { kind: 'resolved', userId: resolved }
}
