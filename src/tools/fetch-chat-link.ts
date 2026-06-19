// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { resolveChatLink as defaultResolveChatLink } from '../chat/mattermost/link-resolver.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:fetch-chat-link' })

const inputSchema = z.object({
  url: z.string().describe('A Mattermost message permalink the user shared (…/<team>/pl/<postId>)'),
  scope: z
    .enum(['post', 'thread'])
    .default('thread')
    .describe("'thread' (default) returns the whole thread; 'post' returns only the linked message"),
})

export interface FetchChatLinkToolDeps {
  resolveChatLink: typeof defaultResolveChatLink
}

const defaultDeps: FetchChatLinkToolDeps = { resolveChatLink: defaultResolveChatLink }

export function makeFetchChatLinkTool(
  platformInstanceId: string,
  requesterUserId: string,
  deps: FetchChatLinkToolDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Follow a Mattermost chat permalink the user shared and return the linked message — or its whole thread — as structured messages, for summarizing or creating a task from it. Only works for links in this workspace and only if you (the requesting user) can access that channel.',
    inputSchema,
    execute: async ({ url, scope }) => {
      try {
        log.debug({ platformInstanceId, requesterUserId, scope }, 'Executing fetch_chat_link')
        return await deps.resolveChatLink({ platformInstanceId, requesterUserId, url, scope })
      } catch (error) {
        log.error(
          {
            platformInstanceId,
            requesterUserId,
            error: error instanceof Error ? error.message : String(error),
            tool: 'fetch_chat_link',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
