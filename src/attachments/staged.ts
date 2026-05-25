// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { and, eq, or, sql } from 'drizzle-orm'

import { parseScopedContextId } from '../chat/scoped-context.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { stagedFiles } from '../db/schema.js'
import { logger } from '../logger.js'
import { saveAttachment } from './store.js'
import type {
  AttachmentRef,
  StageFileParams,
  StagedFileDownloadFn,
  StagedFileRef,
  StagedResolutionError,
} from './types.js'
import { toSourceProvider, toStagedStatus, toUndefinedIfNull } from './types.js'

const log = logger.child({ scope: 'attachments:staged' })

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

type StagedRow = typeof stagedFiles.$inferSelect
type StagedInsert = typeof stagedFiles.$inferInsert

const toRef = (row: StagedRow): StagedFileRef => ({
  stagedId: row.stagedId,
  contextId: row.contextId,
  messageId: row.messageId,
  senderId: row.senderId,
  senderUsername: row.senderUsername,
  filename: row.filename,
  mimeType: row.mimeType,
  size: row.size,
  platformFileId: row.platformFileId,
  sourceProvider: toSourceProvider(row.sourceProvider),
  sourcePlatformInstanceId: row.sourcePlatformInstanceId,
  status: toStagedStatus(row.status),
  attachmentId: row.attachmentId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
})

const buildStagedValues = (
  params: StageFileParams,
  stagedId: string,
  nowIso: string,
  expiresIso: string,
): StagedInsert => ({
  stagedId,
  contextId: params.contextId,
  messageId: params.messageId === undefined ? null : params.messageId,
  senderId: params.senderId,
  senderUsername: params.senderUsername === undefined ? null : params.senderUsername,
  filename: params.filename,
  mimeType: params.mimeType === undefined ? null : params.mimeType,
  size: params.size === undefined ? null : params.size,
  platformFileId: params.platformFileId,
  sourceProvider: params.sourceProvider,
  sourcePlatformInstanceId: params.sourcePlatformInstanceId,
  status: 'staged' as const,
  attachmentId: null,
  createdAt: nowIso,
  expiresAt: expiresIso,
})

export function stageFileMetadata(params: StageFileParams): StagedFileRef {
  const db = getDrizzleDb()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS)
  const nowIso = now.toISOString()
  const expiresIso = expiresAt.toISOString()

  const stagedId = `stg_${randomUUID()}`
  const values = buildStagedValues(params, stagedId, nowIso, expiresIso)

  db.insert(stagedFiles)
    .values(values)
    .onConflictDoUpdate({
      target: [stagedFiles.platformFileId, stagedFiles.contextId],
      set: {
        messageId: params.messageId === undefined ? null : params.messageId,
        senderId: params.senderId,
        senderUsername: params.senderUsername === undefined ? null : params.senderUsername,
        filename: params.filename,
        mimeType: params.mimeType === undefined ? null : params.mimeType,
        size: params.size === undefined ? null : params.size,
        sourcePlatformInstanceId: params.sourcePlatformInstanceId,
        createdAt: nowIso,
        expiresAt: expiresIso,
        status: 'staged',
      },
    })
    .run()

  // After upsert, fetch the row to return the actual stagedId (existing or new)
  const row = db
    .select()
    .from(stagedFiles)
    .where(and(eq(stagedFiles.platformFileId, params.platformFileId), eq(stagedFiles.contextId, params.contextId)))
    .get()

  if (row === undefined) {
    throw new Error('Failed to retrieve staged file after upsert')
  }

  if (row.stagedId === stagedId) {
    log.info({ stagedId, contextId: params.contextId, filename: params.filename }, 'Staged file metadata')
  } else {
    log.debug({ stagedId: row.stagedId }, 'Updated existing staged file metadata')
  }

  return toRef(row)
}

export function searchStagedFiles(
  contextId: string,
  query: string,
  ...limitArg: [] | [number | undefined]
): StagedFileRef[] {
  const db = getDrizzleDb()
  const escaped = query.replaceAll('\\', '\\\\').replaceAll(/[%_]/gu, '\\$&')
  const pattern = `%${escaped}%`
  const queryLimit = limitArg.length === 0 || limitArg[0] === undefined ? 10 : limitArg[0]

  return db
    .select()
    .from(stagedFiles)
    .where(
      and(
        eq(stagedFiles.contextId, contextId),
        eq(stagedFiles.status, 'staged'),
        or(
          sql`${stagedFiles.senderUsername} LIKE ${pattern} ESCAPE '\\'`,
          sql`${stagedFiles.filename} LIKE ${pattern} ESCAPE '\\'`,
        ),
      ),
    )
    .limit(queryLimit)
    .all()
    .map((row) => toRef(row))
}

export function findStagedFilesByMessageId(contextId: string, messageId: string): StagedFileRef[] {
  const db = getDrizzleDb()
  return db
    .select()
    .from(stagedFiles)
    .where(
      and(eq(stagedFiles.contextId, contextId), eq(stagedFiles.messageId, messageId), eq(stagedFiles.status, 'staged')),
    )
    .all()
    .map((row) => toRef(row))
}

export function purgeExpiredStagedFiles(): void {
  try {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    db.delete(stagedFiles)
      .where(sql`${stagedFiles.status} = 'expired' OR ${stagedFiles.expiresAt} < ${now}`)
      .run()

    log.info('Purged expired staged files')
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table: staged_files')) {
      log.debug('staged_files table not found, skipping purge')
      return
    }
    throw error
  }
}

const markStagedStatus = (stagedId: string, status: string): void => {
  getDrizzleDb().update(stagedFiles).set({ status }).where(eq(stagedFiles.stagedId, stagedId)).run()
}

const markStagedResolved = (stagedId: string, attachmentId: string): void => {
  getDrizzleDb()
    .update(stagedFiles)
    .set({ status: 'resolved', attachmentId })
    .where(eq(stagedFiles.stagedId, stagedId))
    .run()
}

const resolveSourcePlatformInstanceId = (row: StagedRow, stagedId: string): string => {
  if (row.sourcePlatformInstanceId !== '') return row.sourcePlatformInstanceId
  const scoped = parseScopedContextId(row.contextId)
  if (scoped === null) return ''
  getDrizzleDb()
    .update(stagedFiles)
    .set({ sourcePlatformInstanceId: scoped.platformInstanceId })
    .where(eq(stagedFiles.stagedId, stagedId))
    .run()
  return scoped.platformInstanceId
}

const checkStagedRowState = (row: StagedRow, stagedId: string): StagedResolutionError | null => {
  if (row.status === 'resolved') {
    if (row.attachmentId === null) return { status: 'already_resolved', attachmentId: 'unknown' }
    return { status: 'already_resolved', attachmentId: row.attachmentId }
  }

  if (row.status === 'failed') {
    return { status: 'download_failed', message: 'Previous download attempt failed. Please re-send the file.' }
  }

  const now = new Date()
  if (new Date(row.expiresAt) < now) {
    markStagedStatus(stagedId, 'expired')
    return {
      status: 'staged_file_expired',
      message:
        'The file cache entry has expired (files are tracked for 24 hours). Ask the sender to re-send or forward the file to the group so it can be staged again.',
    }
  }

  return null
}

const downloadAndPersist = async (
  row: StagedRow,
  stagedId: string,
  downloadFn: StagedFileDownloadFn,
): Promise<AttachmentRef | StagedResolutionError> => {
  const sourcePlatformInstanceId = resolveSourcePlatformInstanceId(row, stagedId)
  const content = await downloadFn(row.platformFileId, toSourceProvider(row.sourceProvider), sourcePlatformInstanceId)
  if (content === null) {
    markStagedStatus(stagedId, 'failed')
    return {
      status: 'download_failed',
      message:
        'Unable to fetch the file from the chat platform. The file may have been removed or the reference expired.',
    }
  }

  const mimeType = toUndefinedIfNull(row.mimeType)
  const size = toUndefinedIfNull(row.size)
  const sourceMessageId = toUndefinedIfNull(row.messageId)

  const attachmentRef = await saveAttachment({
    contextId: row.contextId,
    sourceProvider: toSourceProvider(row.sourceProvider),
    filename: row.filename,
    mimeType,
    size,
    content,
    status: 'available',
    sourceMessageId,
    sourceFileId: row.platformFileId,
  })

  markStagedResolved(stagedId, attachmentRef.attachmentId)
  log.info({ stagedId, attachmentId: attachmentRef.attachmentId }, 'Staged file resolved into workspace')
  return attachmentRef
}

export function resolveStagedFile(
  stagedId: string,
  contextId: string,
  downloadFn: StagedFileDownloadFn,
): Promise<AttachmentRef | StagedResolutionError> {
  const db = getDrizzleDb()
  const row = db
    .select()
    .from(stagedFiles)
    .where(and(eq(stagedFiles.stagedId, stagedId), eq(stagedFiles.contextId, contextId)))
    .get()

  if (row === undefined) {
    return Promise.resolve({
      status: 'not_found',
      message: `Staged file ${stagedId} not found in context ${contextId}.`,
    })
  }

  const stateError = checkStagedRowState(row, stagedId)
  if (stateError !== null) return Promise.resolve(stateError)

  return downloadAndPersist(row, stagedId, downloadFn)
}
