// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { listMemos } from '../memos.js'

const log = logger.child({ scope: 'tool:memo' })

export function makeListMemosTool(userId: string): ToolSet[string] {
  return tool({
    description: 'List personal notes, newest first. Use to show recent notes or browse archived ones.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of memos to return'),
      status: z
        .enum(['active', 'archived'])
        .default('active')
        .describe('Filter by status: active (default) or archived'),
    }),
    execute: ({ limit, status }) => {
      log.debug({ userId, limit, status }, 'list_memos called')
      const results = listMemos(userId, limit, status)
      log.info({ userId, count: results.length, status }, 'Memos listed via tool')
      return { memos: results }
    },
  })
}
