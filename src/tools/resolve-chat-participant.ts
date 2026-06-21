// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { ChatParticipantResolver } from '../chat/participants/roster.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:resolve-chat-participant' })

export function makeResolveChatParticipantTool(resolver: ChatParticipantResolver, contextId: string): ToolSet[string] {
  return tool({
    description:
      'Find a chat group participant by name and return their user ID. ' +
      'Use before populating delivery.mention_user_ids for reminders or any time you need a chat user ID for a named person in this group. ' +
      'Returns a ranked list of candidates; take the top entry when the match is clear. ' +
      'If no confident match is found, ask ONE targeted question naming the returned candidates.',
    inputSchema: z.object({
      query: z.string().trim().min(1).describe('Name or partial name of the person to look up'),
      limit: z.number().int().positive().optional().describe('Maximum number of candidates to return (default 5)'),
    }),
    execute: async ({ query, limit }) => {
      log.debug({ contextId, query, limit }, 'resolve_chat_participant')
      const candidates = await resolver(contextId, query, limit)
      log.info({ contextId, query, count: candidates.length }, 'resolve_chat_participant completed')
      return candidates
    },
  })
}
