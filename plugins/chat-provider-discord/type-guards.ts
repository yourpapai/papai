// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DispatchableMessage, GuildLike, ReadyPayload } from './client-factory.js'

export function isDispatchableMessage(v: unknown): v is DispatchableMessage {
  return typeof v === 'object' && v !== null && 'id' in v && 'author' in v && 'channel' in v
}

export function isGuildLike(v: unknown): v is GuildLike {
  if (typeof v !== 'object' || v === null || !('members' in v)) return false
  const m = v.members
  return typeof m === 'object' && m !== null && 'search' in m && typeof m.search === 'function'
}

export function isReadyPayload(v: unknown): v is ReadyPayload {
  if (typeof v !== 'object' || v === null || !('user' in v)) return false
  const u = v.user
  return typeof u === 'object' && u !== null && 'id' in u && 'username' in u
}
