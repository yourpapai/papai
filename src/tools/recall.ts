// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ContextType } from '../chat/types.js'
import { logger } from '../logger.js'
import { runRecallCascade, type RecallHit } from '../long-term-memory/recall-cascade.js'

const log = logger.child({ scope: 'tool:recall' })

export type RecallToolContext = Readonly<{
  storageContextId: string
  contextType: Extract<ContextType, 'dm' | 'group'>
}>

type PublicRecallRecord = Readonly<{
  id: string
  provenance: RecallHit['provenance']
  kind: RecallHit['kind']
  content: string
  summary: string | null
  tags: readonly string[]
  confidence: number
  status: RecallHit['status']
  lastSeenAt: string
}>

const toPublic = (hit: RecallHit): PublicRecallRecord => ({
  id: hit.id,
  provenance: hit.provenance,
  kind: hit.kind,
  content: hit.content,
  summary: hit.summary,
  tags: hit.tags,
  confidence: hit.confidence,
  status: hit.status,
  lastSeenAt: hit.lastSeenAt,
})

export function makeRecallMemoryTool(input: RecallToolContext): ToolSet[string] {
  return tool({
    description:
      'Recall what is known across this conversation, the shared group memory, and other conversations, in priority order. Prefer this before re-asking the user or claiming no prior knowledge.',
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe('What to recall'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum records to return'),
    }),
    execute: async ({ query, limit }) => {
      const configContextId = getConfigContextIdFromStorageContextId(input.storageContextId)
      const { records } = await runRecallCascade({
        storageContextId: input.storageContextId,
        configContextId,
        contextType: input.contextType,
        query,
        limit,
      })
      log.debug({ storageContextId: input.storageContextId, count: records.length }, 'recall via tool')
      return { mode: 'recall', records: records.map(toPublic) }
    },
  })
}
