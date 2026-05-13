import { createHash, randomUUID } from 'node:crypto'

import { eq, and } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { attachments } from '../db/schema.js'
import { logger } from '../logger.js'
import { buildBlobKey, getBlobStore } from './blob-store.js'
import type {
  AttachmentRef,
  AttachmentSourceProvider,
  AttachmentStatus,
  SaveAttachmentInput,
  StoredAttachment,
} from './types.js'

const STATUS_BY_VALUE: Readonly<Record<string, AttachmentStatus>> = {
  available: 'available',
  tool_only: 'tool_only',
  rejected: 'rejected',
  unavailable: 'unavailable',
}
const SOURCE_BY_VALUE: Readonly<Record<string, AttachmentSourceProvider>> = {
  telegram: 'telegram',
  mattermost: 'mattermost',
  discord: 'discord',
  unknown: 'unknown',
}

const toStatus = (value: string): AttachmentStatus => STATUS_BY_VALUE[value] ?? 'unavailable'
const toSourceProvider = (value: string): AttachmentSourceProvider => SOURCE_BY_VALUE[value] ?? 'unknown'

const log = logger.child({ scope: 'attachments:store' })

export async function saveAttachment(input: SaveAttachmentInput): Promise<AttachmentRef> {
  const attachmentId = `att_${randomUUID()}`
  const createdAt = new Date().toISOString()
  const checksum = createHash('sha256').update(input.content).digest('hex')
  const blobKey = buildBlobKey(input.contextId, attachmentId)

  await getBlobStore().put(blobKey, input.content, input.mimeType)

  getDrizzleDb()
    .insert(attachments)
    .values({
      attachmentId,
      contextId: input.contextId,
      sourceProvider: input.sourceProvider,
      sourceMessageId: input.sourceMessageId,
      sourceFileId: input.sourceFileId,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      checksum,
      blobKey,
      status: input.status,
      isActive: 1,
      createdAt,
      clearedAt: null,
      lastUsedAt: null,
    })
    .run()

  log.info({ attachmentId, contextId: input.contextId, filename: input.filename, blobKey }, 'Attachment stored')

  const ref: AttachmentRef = {
    attachmentId,
    contextId: input.contextId,
    filename: input.filename,
    status: input.status,
  }
  if (input.mimeType !== undefined) ref.mimeType = input.mimeType
  if (input.size !== undefined) ref.size = input.size
  return ref
}

export async function loadAttachmentRecord(contextId: string, attachmentId: string): Promise<StoredAttachment | null> {
  const row = getDrizzleDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.contextId, contextId), eq(attachments.attachmentId, attachmentId)))
    .get()

  if (row === undefined || row.clearedAt !== null) return null

  const content = await getBlobStore().get(row.blobKey)

  const stored: StoredAttachment = {
    attachmentId: row.attachmentId,
    contextId: row.contextId,
    filename: row.filename,
    status: toStatus(row.status),
    sourceProvider: toSourceProvider(row.sourceProvider),
    checksum: row.checksum,
    blobKey: row.blobKey,
    createdAt: row.createdAt,
    content,
  }
  if (row.mimeType !== null) stored.mimeType = row.mimeType
  if (row.size !== null) stored.size = row.size
  if (row.sourceMessageId !== null) stored.sourceMessageId = row.sourceMessageId
  if (row.sourceFileId !== null) stored.sourceFileId = row.sourceFileId
  if (row.clearedAt !== null) stored.clearedAt = row.clearedAt
  if (row.lastUsedAt !== null) stored.lastUsedAt = row.lastUsedAt
  return stored
}
