// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { eq, and, or } from 'drizzle-orm'
import { z } from 'zod'

import { getBlobStore } from '../attachments/blob-store.js'
import { listActiveAttachments } from '../attachments/index.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { attachments } from '../db/schema.js'
import { logger } from '../logger.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:workspace-files' })

export function makeListFilesTool(contextId: string, groupContextId?: string): ToolSet[string] {
  return tool({
    description:
      'List all files currently available in the conversation workspace. These are files the user has sent during this conversation and which can be referenced or uploaded to tasks.',
    inputSchema: z.object({}),
    execute: () => {
      log.debug({ contextId }, 'list_files called')
      const active = listActiveAttachments(contextId, groupContextId === undefined ? undefined : { groupContextId })
      return active.map((ref) => ({
        fileId: ref.attachmentId,
        filename: ref.filename,
        mimeType: ref.mimeType,
        size: ref.size,
        status: ref.status,
      }))
    },
  })
}

export function makeDeleteFileTool(contextId: string, groupContextId?: string): ToolSet[string] {
  return tool({
    description:
      'Permanently delete a file from the conversation workspace. This is a destructive action that requires confirmation.',
    inputSchema: z.object({
      fileId: z.string().describe('Stable papai file ID to delete (e.g. att_<uuid>)'),
      confidence: confidenceField,
    }),
    execute: async ({ fileId, confidence }) => {
      log.debug({ contextId, fileId, confidence }, 'delete_file called')
      const gate = checkConfidence(confidence, `Delete file "${fileId}"`)
      if (gate !== null) {
        log.warn({ contextId, fileId, confidence }, 'delete_file blocked — confirmation required')
        return gate
      }

      const scopeCondition =
        groupContextId === undefined
          ? eq(attachments.contextId, contextId)
          : or(eq(attachments.contextId, contextId), eq(attachments.groupContextId, groupContextId))

      const row = getDrizzleDb()
        .select({ blobKey: attachments.blobKey })
        .from(attachments)
        .where(and(scopeCondition, eq(attachments.attachmentId, fileId), eq(attachments.isActive, 1)))
        .get()

      if (row === undefined) {
        log.warn({ contextId, fileId }, 'delete_file — fileId not found in workspace')
        return {
          status: 'not_found',
          message: `File "${fileId}" is not available in this workspace.`,
        }
      }

      await getBlobStore().delete(row.blobKey)

      getDrizzleDb()
        .update(attachments)
        .set({ isActive: 0, clearedAt: new Date().toISOString() })
        .where(eq(attachments.attachmentId, fileId))
        .run()

      log.info({ contextId, fileId }, 'File deleted from workspace')
      return { status: 'deleted', fileId }
    },
  })
}
