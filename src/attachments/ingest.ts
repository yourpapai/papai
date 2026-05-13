import type { IncomingFile } from '../chat/types.js'
import { saveAttachment } from './store.js'
import type { AttachmentRef, AttachmentSourceProvider, SaveAttachmentInput } from './types.js'

type PersistIncomingAttachmentsParams = {
  contextId: string
  sourceProvider: AttachmentSourceProvider
  files: readonly IncomingFile[]
} & Partial<{
  sourceMessageId: string
}>

const buildInput = (file: IncomingFile, params: PersistIncomingAttachmentsParams): SaveAttachmentInput => {
  const input: SaveAttachmentInput = {
    contextId: params.contextId,
    sourceProvider: params.sourceProvider,
    filename: file.filename,
    status: 'available',
    content: file.content,
    sourceFileId: file.fileId,
  }
  if (params.sourceMessageId !== undefined) input.sourceMessageId = params.sourceMessageId
  if (file.mimeType !== undefined) input.mimeType = file.mimeType
  if (file.size !== undefined) input.size = file.size
  return input
}

export function persistIncomingAttachments(params: PersistIncomingAttachmentsParams): Promise<AttachmentRef[]> {
  return Promise.all(params.files.map((file) => saveAttachment(buildInput(file, params))))
}
