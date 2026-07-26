// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getEmbeddingForContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { saveMemo, updateMemoEmbedding } from '../memos.js'
import { toolErrorClass } from './tool-logging.js'

const log = logger.child({ scope: 'tool:memo' })

export function makeSaveMemoTool(userId: string): Tool {
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
      log.debug({ contentLength: content.length }, 'save_memo called')
      const memo = saveMemo(userId, content, tags ?? [], summary)
      log.info({ tagCount: memo.tags.length }, 'Memo saved via tool')

      void getEmbeddingForContext(content, userId, {
        storageContextId: userId,
        contextType: 'dm',
        chatUserId: userId,
      })
        .then((embedding) => {
          if (embedding !== null) {
            updateMemoEmbedding(userId, memo.id, new Float32Array(embedding))
          }
        })
        .catch((error: unknown) => {
          log.error({ errorClass: toolErrorClass(error) }, 'Embedding failed')
        })

      return { id: memo.id, content: memo.content, tags: memo.tags, createdAt: memo.createdAt }
    },
  })
}
