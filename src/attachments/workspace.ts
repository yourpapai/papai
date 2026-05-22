// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { attachments } from '../db/schema.js'
import { logger } from '../logger.js'
import { getBlobStore } from './blob-store.js'
import type { AttachmentRef, AttachmentStatus } from './types.js'

const log = logger.child({ scope: 'attachments:workspace' })

const STATUS_BY_VALUE: Readonly<Record<string, AttachmentStatus>> = {
  available: 'available',
  tool_only: 'tool_only',
  rejected: 'rejected',
  unavailable: 'unavailable',
}
const toStatus = (value: string): AttachmentStatus => STATUS_BY_VALUE[value] ?? 'unavailable'

export function listActiveAttachments(contextId: string): AttachmentRef[] {
  return getDrizzleDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.contextId, contextId), eq(attachments.isActive, 1)))
    .all()
    .filter((row) => row.clearedAt === null)
    .map((row) => {
      const ref: AttachmentRef = {
        attachmentId: row.attachmentId,
        contextId: row.contextId,
        filename: row.filename,
        status: toStatus(row.status),
      }
      if (row.mimeType !== null) ref.mimeType = row.mimeType
      if (row.size !== null) ref.size = row.size
      return ref
    })
}

/**
 * Remove all attachments and their blobs for a context.
 * @internal — used directly by workspace tests and internal cleanup code.
 */
export async function clearAttachmentWorkspace(contextId: string): Promise<void> {
  const rows = getDrizzleDb()
    .select({ blobKey: attachments.blobKey })
    .from(attachments)
    .where(eq(attachments.contextId, contextId))
    .all()

  if (rows.length > 0) {
    await getBlobStore().deleteMany(rows.map((row) => row.blobKey))
  }

  getDrizzleDb().delete(attachments).where(eq(attachments.contextId, contextId)).run()
  log.info({ contextId, count: rows.length }, 'Attachment workspace cleared')
}
