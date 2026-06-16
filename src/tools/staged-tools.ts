// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { resolveStagedFile, searchStagedFiles } from '../attachments/staged.js'
import type { StagedFileDownloadFn } from '../attachments/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:staged-files' })

export function makeSearchStagedFilesTool(contextId: string, groupContextId?: string): ToolSet[string] {
  return tool({
    description:
      'Search staged files in the current conversation that have not yet been resolved. Staged files are files sent by any group member that are available to be brought into the workspace. Search by sender username or filename.',
    inputSchema: z.object({
      query: z.string().describe('Search term: sender username or filename substring'),
      limit: z.number().min(1).max(20).optional().describe('Maximum results to return (default: 10)'),
    }),
    execute: ({ query, limit }) => {
      log.debug({ contextId, query, limit }, 'search_staged_files called')
      const results = searchStagedFiles(contextId, query, { groupContextId, limit })
      return results.map((ref) => ({
        stagedId: ref.stagedId,
        filename: ref.filename,
        mimeType: ref.mimeType,
        size: ref.size,
        senderUsername: ref.senderUsername,
        createdAt: ref.createdAt,
      }))
    },
  })
}

export function makeResolveStagedFileTool(
  contextId: string,
  downloadFn: StagedFileDownloadFn,
  groupContextId?: string,
): ToolSet[string] {
  return tool({
    description:
      'Resolve a staged file by downloading it from the chat platform and adding it to the conversation workspace. After resolution, the file can be uploaded to tasks or referenced by its attachment ID.',
    inputSchema: z.object({
      stagedId: z.string().describe('The staged file ID (starts with stg_) to resolve'),
    }),
    execute: async ({ stagedId }) => {
      log.debug({ contextId, stagedId }, 'resolve_staged_file called')
      const result = await resolveStagedFile(
        stagedId,
        contextId,
        downloadFn,
        groupContextId === undefined ? undefined : { groupContextId },
      )
      if ('contextId' in result) {
        return {
          status: 'resolved' as const,
          attachmentId: result.attachmentId,
          filename: result.filename,
        }
      }
      return result
    },
  })
}
