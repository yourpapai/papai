// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { archiveMemos } from '../memos.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:memo' })

function buildDescription(tag?: string, beforeDate?: string, memoIds?: string[]): string {
  if (tag !== undefined) return `Archive all notes tagged "${tag}"`
  if (beforeDate !== undefined) return `Archive all notes before ${beforeDate}`
  return `Archive ${memoIds?.length ?? 0} note(s)`
}

export function makeArchiveMemosTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Archive personal notes by tag, date, or specific IDs. Exactly one filter must be provided.',
    inputSchema: z.object({
      tag: z.string().optional().describe('Archive all memos with this tag'),
      beforeDate: z.string().optional().describe('Archive memos created before this ISO date'),
      memoIds: z.array(z.string()).optional().describe('Archive specific memos by ID'),
      confidence: confidenceField,
    }),
    execute: ({ tag, beforeDate, memoIds, confidence }) => {
      log.debug({ userId, tag, beforeDate, memoIdCount: memoIds?.length, confidence }, 'archive_memos called')

      const filterCount =
        (tag === undefined ? 0 : 1) +
        (beforeDate === undefined ? 0 : 1) +
        (memoIds === undefined || memoIds.length === 0 ? 0 : 1)

      if (filterCount === 0) {
        log.warn({ userId }, 'archive_memos rejected — no filter provided')
        return { status: 'error', message: 'Exactly one filter (tag, beforeDate, or memoIds) is required.' }
      }

      if (filterCount > 1) {
        log.warn({ userId, tag, beforeDate, memoIdCount: memoIds?.length }, 'archive_memos rejected — multiple filters')
        return { status: 'error', message: 'Exactly one filter (tag, beforeDate, or memoIds) must be provided.' }
      }

      const isIdBased = memoIds !== undefined && memoIds.length > 0
      if (!isIdBased) {
        const gate = checkConfidence(confidence, buildDescription(tag, beforeDate, memoIds))
        if (gate !== null) {
          log.warn({ userId, confidence }, 'archive_memos blocked — confirmation required')
          return gate
        }
      }

      const count = archiveMemos(userId, { tag, beforeDate, memoIds })
      log.info({ userId, count, tag, beforeDate }, 'Memos archived via tool')
      return { status: 'archived', count }
    },
  })
}
