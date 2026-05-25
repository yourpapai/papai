// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  isS3Configured,
  listActiveAttachments,
  persistIncomingAttachments,
  stageFileMetadata,
} from './attachments/index.js'
import { toSourceProvider, type AttachmentRef, type AttachmentSourceProvider } from './attachments/types.js'
import type { ChatProvider, IncomingFile, IncomingFileCandidate, IncomingMessage } from './chat/types.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'bot-attachments' })

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

export type StageGroupCandidatesDeps = {
  stageFileMetadataFn: (
    params: import('./attachments/types.js').StageFileParams,
  ) => import('./attachments/types.js').StagedFileRef
}

const defaultStageGroupCandidatesDeps: StageGroupCandidatesDeps = {
  stageFileMetadataFn: stageFileMetadata,
}

export function stageGroupFileCandidates(
  params: StageGroupCandidatesParams,
  deps: StageGroupCandidatesDeps = defaultStageGroupCandidatesDeps,
): void {
  if (!isS3Configured()) return
  const candidates: readonly IncomingFileCandidate[] = params.msg.fileCandidates ?? []
  for (const candidate of candidates) {
    try {
      deps.stageFileMetadataFn({
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
    } catch (error: unknown) {
      log.warn(
        {
          contextId: params.storageContextId,
          messageId: params.msg.messageId,
          filename: candidate.filename,
          fileId: candidate.fileId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to stage group file candidate',
      )
    }
  }
}

export async function ingestDmAttachments(params: IngestDmAttachmentsParams): Promise<IngestAttachmentsResult> {
  if (!isS3Configured()) {
    return { newAttachmentIds: [], activeAttachments: [] }
  }
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
  return {
    newAttachmentIds: [],
    activeAttachments: isS3Configured() ? listActiveAttachments(storageContextId) : [],
  }
}
