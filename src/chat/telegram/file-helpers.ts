// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { IncomingFile, IncomingFileCandidate } from '../types.js'

const log = logger.child({ scope: 'chat:telegram:files' })

/** Minimal interface for extractFilesFromContext input. Matches grammy Context structure. */
export interface ExtractFilesInput {
  message?: {
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
    photo?: Array<{ file_id: string; file_size?: number }>
    audio?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
    video?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
    voice?: { file_id: string; file_size?: number }
  }
}

/** Callback that downloads a Telegram file by file_id, returning its content or null on failure. */
export type TelegramFileFetcher = (fileId: string) => Promise<Buffer | null>

type FileCandidate = { fileId: string; filename: string; mimeType?: string; size?: number }

const getDocumentCandidate = (msg: ExtractFilesInput['message']): FileCandidate | undefined =>
  msg?.document === undefined
    ? undefined
    : {
        fileId: msg.document.file_id,
        filename: msg.document.file_name ?? 'document',
        mimeType: msg.document.mime_type,
        size: msg.document.file_size,
      }

const getPhotoCandidate = (msg: ExtractFilesInput['message']): FileCandidate | undefined => {
  const largest = msg?.photo?.[msg.photo.length - 1]
  return largest === undefined
    ? undefined
    : {
        fileId: largest.file_id,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: largest.file_size,
      }
}

const getAudioCandidate = (msg: ExtractFilesInput['message']): FileCandidate | undefined =>
  msg?.audio === undefined
    ? undefined
    : {
        fileId: msg.audio.file_id,
        filename: msg.audio.file_name ?? 'audio',
        mimeType: msg.audio.mime_type,
        size: msg.audio.file_size,
      }

const getVideoCandidate = (msg: ExtractFilesInput['message']): FileCandidate | undefined =>
  msg?.video === undefined
    ? undefined
    : {
        fileId: msg.video.file_id,
        filename: msg.video.file_name ?? 'video',
        mimeType: msg.video.mime_type,
        size: msg.video.file_size,
      }

const getVoiceCandidate = (msg: ExtractFilesInput['message']): FileCandidate | undefined =>
  msg?.voice === undefined
    ? undefined
    : {
        fileId: msg.voice.file_id,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
        size: msg.voice.file_size,
      }

/** Build the list of file candidates from a message (synchronous). */
function buildFileCandidates(msg: ExtractFilesInput['message']): FileCandidate[] {
  return [
    getDocumentCandidate(msg),
    getPhotoCandidate(msg),
    getAudioCandidate(msg),
    getVideoCandidate(msg),
    getVoiceCandidate(msg),
  ].filter((candidate): candidate is FileCandidate => candidate !== undefined)
}

/** Extract attached files from a Telegram message context. Exported for testing. */
export async function extractFilesFromContext(
  ctx: ExtractFilesInput,
  fetchFile: TelegramFileFetcher,
): Promise<IncomingFile[]> {
  const candidates = buildFileCandidates(ctx.message)
  if (candidates.length === 0) return []

  const settled = await Promise.all(
    candidates.map(async (candidate): Promise<IncomingFile | null> => {
      const content = await fetchFile(candidate.fileId)
      if (content === null) {
        log.warn({ fileId: candidate.fileId }, 'Telegram file fetch returned null, skipping')
        return null
      }
      return { ...candidate, content }
    }),
  )
  return settled.filter((f): f is IncomingFile => f !== null)
}

export function extractFileCandidatesFromContext(ctx: ExtractFilesInput): IncomingFileCandidate[] {
  return buildFileCandidates(ctx.message)
}
