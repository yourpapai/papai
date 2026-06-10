// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { emitUser } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import { ALWAYS_ON_TOOL_NAMES } from './core.js'
import type { DisclosureSession } from './registry.js'
import { buildBriefs } from './tool-brief.js'
import type { ToolRetriever } from './tool-retriever.js'

const log = logger.child({ scope: 'tool:search_tools' })

export function makeSearchToolsTool(
  session: DisclosureSession,
  retriever: ToolRetriever,
  contextId: string,
  toolsForBriefs: ToolSet = {},
): ToolSet[string] {
  return tool({
    description:
      'Find tools by intent. Most tools are NOT loaded; call this with a short natural-language query, then load_tool the names you need before using them.',
    inputSchema: z.object({
      query: z.string().min(1).describe('What you are trying to do, e.g. "list overdue tasks"'),
      limit: z.number().int().min(1).max(20).default(8).describe('Maximum tools to return'),
    }),
    execute: async ({ query, limit }) => {
      const discoverable = buildBriefs(toolsForBriefs).filter((b) => !ALWAYS_ON_TOOL_NAMES.has(b.name))
      const ranked = await retriever.rank(query, discoverable, limit)
      const loadedNow = new Set(session.activeToolNames())
      const results = ranked.map((b) => ({
        name: b.name,
        summary: b.summary,
        domain: b.domain,
        alreadyLoaded: loadedNow.has(b.name),
      }))
      emitUser('disclosure:search', contextId, { queryLength: query.length, resultCount: results.length })
      log.debug({ contextId, queryLength: query.length, resultCount: results.length }, 'search_tools served')
      return { results }
    },
  })
}
