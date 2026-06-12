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
import { resolveSourceProviderName } from './chat/source-instance.js'
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
  ...rest: [] | [StageGroupCandidatesDeps]
): void {
  if (!isS3Configured()) return
  const deps = rest.length === 0 ? defaultStageGroupCandidatesDeps : rest[0]
  let candidates: readonly IncomingFileCandidate[] = []
  if (params.msg.fileCandidates !== undefined) candidates = params.msg.fileCandidates
  for (const candidate of candidates) {
    try {
      let messageId: string | null = null
      if (params.msg.messageId !== undefined) messageId = params.msg.messageId
      let senderUsername: string | null = null
      if (params.msg.user.username !== undefined) senderUsername = params.msg.user.username
      let mimeType: string | null = null
      if (candidate.mimeType !== undefined) mimeType = candidate.mimeType
      let size: number | null = null
      if (candidate.size !== undefined) size = candidate.size
      deps.stageFileMetadataFn({
        contextId: params.storageContextId,
        messageId,
        senderId: params.msg.user.id,
        senderUsername,
        filename: candidate.filename,
        mimeType,
        size,
        platformFileId: candidate.fileId,
        sourceProvider: params.sourceProvider,
        sourcePlatformInstanceId: params.msg.platformInstanceId,
        origin: null,
        forwardedFrom: null,
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
    sourceProvider: toSourceProvider(resolveSourceProviderName(params.chat, params.msg.platformInstanceId)),
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
    let files: readonly IncomingFile[] = []
    if (msg.files !== undefined) files = msg.files
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
