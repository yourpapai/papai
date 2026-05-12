import { randomUUID } from 'node:crypto'

import { and, eq, like, or, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { stagedFiles } from '../db/schema.js'
import { logger } from '../logger.js'
import { saveAttachment } from './store.js'
import type {
  AttachmentRef,
  AttachmentSourceProvider,
  StageFileParams,
  StagedFileDownloadFn,
  StagedFileRef,
  StagedFileStatus,
  StagedResolutionError,
} from './types.js'

const log = logger.child({ scope: 'attachments:staged' })

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

const SOURCE_BY_VALUE: Readonly<Record<string, AttachmentSourceProvider>> = {
  telegram: 'telegram',
  mattermost: 'mattermost',
  discord: 'discord',
  unknown: 'unknown',
}

const STAGED_STATUS_BY_VALUE: Readonly<Record<string, StagedFileStatus>> = {
  staged: 'staged',
  resolved: 'resolved',
  failed: 'failed',
  expired: 'expired',
}

const toSourceProvider = (value: string): AttachmentSourceProvider => SOURCE_BY_VALUE[value] ?? 'unknown'
const toStagedStatus = (value: string): StagedFileStatus => STAGED_STATUS_BY_VALUE[value] ?? 'expired'

type StagedRow = typeof stagedFiles.$inferSelect

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
  status: toStagedStatus(row.status),
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
})

const buildStagedValues = (
  params: StageFileParams,
  stagedId: string,
  nowIso: string,
  expiresIso: string,
): StagedRow => ({
  stagedId,
  contextId: params.contextId,
  messageId: params.messageId ?? null,
  senderId: params.senderId,
  senderUsername: params.senderUsername ?? null,
  filename: params.filename,
  mimeType: params.mimeType ?? null,
  size: params.size ?? null,
  platformFileId: params.platformFileId,
  sourceProvider: params.sourceProvider,
  status: 'staged' as const,
  createdAt: nowIso,
  expiresAt: expiresIso,
})

const updateExistingStaged = (
  existing: StagedRow,
  params: StageFileParams,
  nowIso: string,
  expiresIso: string,
): StagedFileRef => {
  const db = getDrizzleDb()
  db.update(stagedFiles)
    .set({
      messageId: params.messageId ?? null,
      senderId: params.senderId,
      senderUsername: params.senderUsername ?? null,
      filename: params.filename,
      mimeType: params.mimeType ?? null,
      size: params.size ?? null,
      createdAt: nowIso,
      expiresAt: expiresIso,
      status: 'staged',
    })
    .where(eq(stagedFiles.stagedId, existing.stagedId))
    .run()

  log.debug({ stagedId: existing.stagedId }, 'Updated existing staged file metadata')
  return toRef({
    ...existing,
    messageId: params.messageId ?? null,
    createdAt: nowIso,
    expiresAt: expiresIso,
    status: 'staged',
  })
}

const insertNewStaged = (params: StageFileParams, nowIso: string, expiresIso: string): StagedFileRef => {
  const db = getDrizzleDb()
  const stagedId = `stg_${randomUUID()}`
  const values = buildStagedValues(params, stagedId, nowIso, expiresIso)
  db.insert(stagedFiles).values(values).run()
  log.info({ stagedId, contextId: params.contextId, filename: params.filename }, 'Staged file metadata')
  return toRef(values)
}

export function stageFileMetadata(params: StageFileParams): StagedFileRef {
  const db = getDrizzleDb()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS)
  const nowIso = now.toISOString()
  const expiresIso = expiresAt.toISOString()

  const existing = db
    .select()
    .from(stagedFiles)
    .where(and(eq(stagedFiles.platformFileId, params.platformFileId), eq(stagedFiles.contextId, params.contextId)))
    .get()

  if (existing !== undefined) {
    return updateExistingStaged(existing, params, nowIso, expiresIso)
  }

  return insertNewStaged(params, nowIso, expiresIso)
}

export function searchStagedFiles(contextId: string, query: string, limit: number = 10): StagedFileRef[] {
  const db = getDrizzleDb()
  const pattern = `%${query}%`

  return db
    .select()
    .from(stagedFiles)
    .where(
      and(
        eq(stagedFiles.contextId, contextId),
        eq(stagedFiles.status, 'staged'),
        or(like(stagedFiles.senderUsername, pattern), like(stagedFiles.filename, pattern)),
      ),
    )
    .limit(limit)
    .all()
    .map(toRef)
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
    .map(toRef)
}

export function purgeExpiredStagedFiles(): number {
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  db.delete(stagedFiles)
    .where(sql`${stagedFiles.status} = 'expired' OR ${stagedFiles.expiresAt} < ${now}`)
    .run()

  const row = db.$client.query<{ 'changes()': number }, []>('SELECT changes()').get()
  const count = row?.['changes()'] ?? 0
  if (count > 0) log.info({ count }, 'Purged expired staged files')
  return count
}

const markStagedStatus = (stagedId: string, status: string): void => {
  getDrizzleDb().update(stagedFiles).set({ status }).where(eq(stagedFiles.stagedId, stagedId)).run()
}

const checkStagedRowState = (row: StagedRow, stagedId: string): StagedResolutionError | null => {
  if (row.status === 'resolved') {
    return { status: 'already_resolved', attachmentId: 'unknown' }
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
  const content = await downloadFn(row.platformFileId, toSourceProvider(row.sourceProvider))
  if (content === null) {
    markStagedStatus(stagedId, 'failed')
    return {
      status: 'download_failed',
      message:
        'Unable to fetch the file from the chat platform. The file may have been removed or the reference expired.',
    }
  }

  const attachmentRef = await saveAttachment({
    contextId: row.contextId,
    sourceProvider: toSourceProvider(row.sourceProvider),
    filename: row.filename,
    mimeType: row.mimeType ?? undefined,
    size: row.size ?? undefined,
    content,
    status: 'available',
    sourceMessageId: row.messageId ?? undefined,
    sourceFileId: row.platformFileId,
  })

  markStagedStatus(stagedId, 'resolved')
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
