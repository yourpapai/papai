import { listActiveAttachments, persistIncomingAttachments, stageFileMetadata } from './attachments/index.js'
import type { AttachmentRef, AttachmentSourceProvider } from './attachments/types.js'
import type { ChatProvider, IncomingFile, IncomingFileCandidate, IncomingMessage } from './chat/types.js'

const SOURCE_BY_NAME: Readonly<Record<string, AttachmentSourceProvider>> = {
  telegram: 'telegram',
  mattermost: 'mattermost',
  discord: 'discord',
}

export const toSourceProvider = (name: string): AttachmentSourceProvider => SOURCE_BY_NAME[name] ?? 'unknown'

export type IngestDmAttachmentsParams = {
  chat: ChatProvider
  msg: IncomingMessage
  storageContextId: string
  files: readonly IncomingFile[]
}

export type IngestAttachmentsResult = {
  newAttachmentIds: readonly string[]
  activeAttachments: readonly AttachmentRef[]
}

export type StageGroupCandidatesParams = {
  storageContextId: string
  msg: IncomingMessage
  sourceProvider: AttachmentSourceProvider
}

export async function ingestDmAttachments(params: IngestDmAttachmentsParams): Promise<IngestAttachmentsResult> {
  const persistParams: Parameters<typeof persistIncomingAttachments>[0] = {
    contextId: params.storageContextId,
    sourceProvider: toSourceProvider(params.chat.name),
    files: params.files,
  }
  if (params.msg.messageId !== undefined) persistParams.sourceMessageId = params.msg.messageId
  const newRefs = await persistIncomingAttachments(persistParams)
  const activeAttachments = listActiveAttachments(params.storageContextId)
  return {
    newAttachmentIds: newRefs.map((ref) => ref.attachmentId),
    activeAttachments,
  }
}

export function stageGroupFileCandidates(params: StageGroupCandidatesParams): void {
  const candidates: readonly IncomingFileCandidate[] = params.msg.fileCandidates ?? []
  for (const candidate of candidates) {
    stageFileMetadata({
      contextId: params.storageContextId,
      messageId: params.msg.messageId ?? null,
      senderId: params.msg.user.id,
      senderUsername: params.msg.user.username ?? null,
      filename: candidate.filename,
      mimeType: candidate.mimeType ?? null,
      size: candidate.size ?? null,
      platformFileId: candidate.fileId,
      sourceProvider: params.sourceProvider,
    })
  }
}

export async function resolveMessageAttachments(
  chat: ChatProvider,
  msg: IncomingMessage,
  storageContextId: string,
): Promise<IngestAttachmentsResult> {
  if (msg.contextType === 'dm') {
    const files: readonly IncomingFile[] = msg.files ?? []
    if (files.length > 0) {
      const result = await ingestDmAttachments({ chat, msg, storageContextId, files })
      return result
    }
  }
  return { newAttachmentIds: [], activeAttachments: listActiveAttachments(storageContextId) }
}
