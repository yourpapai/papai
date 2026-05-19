// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { tryGetEmbedding } from '../embeddings.js'
import { logger } from '../logger.js'
import { saveMemo, updateMemoEmbedding } from '../memos.js'
import { getSystemConfig } from '../system-config.js'

const log = logger.child({ scope: 'tool:memo' })

export function makeSaveMemoTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Save a personal note or observation. Use when the user is recording information, a thought, a link, or a fact — not when tracking work to be done.',
    inputSchema: z.object({
      content: z.string().min(1).describe('The note text to save'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Tags extracted from hashtags, "tag: X" mentions, or inferred from context'),
      summary: z.string().optional().describe('Optional one-line summary of the note'),
    }),
    execute: ({ content, tags, summary }) => {
      log.debug({ userId, contentLength: content.length }, 'save_memo called')
      const memo = saveMemo(userId, content, tags ?? [], summary)
      log.info({ userId, memoId: memo.id, tags: memo.tags }, 'Memo saved via tool')

      const apiKey = getSystemConfig('llm_apikey')
      const baseUrl = getSystemConfig('llm_baseurl')
      const embeddingModel = getSystemConfig('embedding_model')
      if (apiKey !== null && baseUrl !== null && embeddingModel !== null) {
        void tryGetEmbedding(content, apiKey, baseUrl, embeddingModel)
          .then((embedding) => {
            if (embedding !== null) {
              updateMemoEmbedding(userId, memo.id, new Float32Array(embedding))
            }
          })
          .catch((error: unknown) => {
            log.error(
              { memoId: memo.id, error: error instanceof Error ? error.message : String(error) },
              'Embedding failed',
            )
          })
      }

      return { id: memo.id, content: memo.content, tags: memo.tags, createdAt: memo.createdAt }
    },
  })
}
