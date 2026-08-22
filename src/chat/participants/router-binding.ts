// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ResolveUserContext } from '../types.js'
import { resolveChatParticipant, type ChatParticipantResolver } from './roster.js'

/** The label lookup the resolver needs — the part of ChatRouter it actually uses. */
export type UserLabelSource = Readonly<{
  resolveUserLabel(userId: string, context: ResolveUserContext | undefined): Promise<string | null>
}>

/**
 * Bind the roster resolver to a label source. Shared by production wiring and the
 * story harness so neither can drift from the other's notion of the label context.
 */
export function createChatParticipantResolver(source: UserLabelSource): ChatParticipantResolver {
  return (contextId, query, ...rest) =>
    resolveChatParticipant(
      contextId,
      query,
      (userId) => source.resolveUserLabel(userId, { contextId, contextType: 'group' }),
      ...rest,
    )
}
