// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  findStagedFilesByMessageId,
  isS3Configured,
  listActiveAttachments,
  persistIncomingAttachments,
  resolveStagedFile,
  stageFileMetadata,
} from './attachments/index.js'
import {
  toSourceProvider,
  type AttachmentRef,
  type AttachmentSourceProvider,
  type StagedFileDownloadFn,
} from './attachments/types.js'
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
        origin: candidate.origin ?? null,
        forwardedFrom: candidate.forwardedFrom ?? null,
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

/**
 * Cheap synchronous lookup — returns the staged-row ids of voice-origin files
 * attached to the given message. No download or network call is made.
 */
export function findVoiceStagedIds(storageContextId: string, messageId: string | undefined): string[] {
  if (!isS3Configured() || messageId === undefined) return []
  return findStagedFilesByMessageId(storageContextId, messageId)
    .filter((staged) => staged.origin === 'voice')
    .map((staged) => staged.stagedId)
}

/**
 * Eagerly resolve voice-origin staged files identified by their staged ids.
 * Group chats stage files lazily; a voice note addressed to the bot IS the
 * message, so it must be available before the LLM turn starts. Ordinary
 * staged files keep lazy resolution via the resolve_staged_file tool.
 *
 * Per-id errors (network/S3/thrown) are caught and skipped — the function
 * always resolves and never throws.
 */
async function resolveSingleStagedId(
  stagedId: string,
  storageContextId: string,
  downloadFn: StagedFileDownloadFn,
): Promise<string | null> {
  try {
    const result = await resolveStagedFile(stagedId, storageContextId, downloadFn)
    if ('attachmentId' in result && result.attachmentId !== null && result.attachmentId !== 'unknown') {
      return result.attachmentId
    }
    log.warn({ stagedId, contextId: storageContextId }, 'Eager voice staged-file resolution failed')
    return null
  } catch (error: unknown) {
    log.warn(
      {
        stagedId,
        contextId: storageContextId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Eager voice staged-file resolution threw',
    )
    return null
  }
}

export async function resolveVoiceStagedFiles(
  storageContextId: string,
  stagedIds: readonly string[],
  downloadFn: StagedFileDownloadFn | undefined,
): Promise<string[]> {
  if (!isS3Configured() || stagedIds.length === 0 || downloadFn === undefined) return []
  const resolved = await Promise.all(
    stagedIds.map((stagedId) => resolveSingleStagedId(stagedId, storageContextId, downloadFn)),
  )
  return resolved.filter((id): id is string => id !== null)
}
