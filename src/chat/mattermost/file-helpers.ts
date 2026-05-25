// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { cacheMessage } from '../../message-cache/index.js'
import type { IncomingFile, IncomingFileCandidate } from '../types.js'
import {
  FileUploadSchema,
  MattermostFileInfoSchema,
  type MattermostPost,
  MattermostPostSchema,
  MattermostPostedDataSchema,
  UserMeSchema,
} from './schema.js'

const log = logger.child({ scope: 'chat:mattermost:files' })

export type MattermostApiFetch = (method: string, path: string, body: unknown) => Promise<unknown>

export async function resolveMattermostUserId(username: string, apiFetch: MattermostApiFetch): Promise<string | null> {
  const cleanUsername = username.startsWith('@') ? username.slice(1) : username
  try {
    const data = await apiFetch('GET', `/api/v4/users/username/${encodeURIComponent(cleanUsername)}`, undefined)
    const parsed = UserMeSchema.safeParse(data)
    if (parsed.success) return parsed.data.id
    return null
  } catch {
    return null
  }
}

export async function buildMattermostMentionPrefix(
  mentionUserIds: readonly string[],
  createdByUsername: string | null,
  apiFetch: MattermostApiFetch,
): Promise<string> {
  const usernames = await Promise.all(
    mentionUserIds.map(async (userId): Promise<string | null> => {
      try {
        const data = await apiFetch('GET', `/api/v4/users/${encodeURIComponent(userId)}`, undefined)
        const parsed = UserMeSchema.safeParse(data)
        return parsed.success && parsed.data.username !== undefined ? parsed.data.username : null
      } catch {
        return null
      }
    }),
  )

  const mentions = usernames.flatMap((username) => (username === null ? [] : [`@${username}`]))
  if (mentions.length > 0) {
    return `${mentions.join(' ')} `
  }

  if (createdByUsername === null) {
    return ''
  }

  return `@${createdByUsername} `
}

export async function fetchMattermostFiles(
  fileIds: string[],
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
  fetchContent: (fileId: string) => Promise<Buffer | null>,
): Promise<IncomingFile[]> {
  const files = await Promise.all(
    fileIds.map(async (fileId): Promise<IncomingFile | null> => {
      try {
        const infoData = await apiFetch('GET', `/api/v4/files/${fileId}/info`, undefined)
        const parsed = MattermostFileInfoSchema.safeParse(infoData)
        if (!parsed.success) {
          log.warn({ fileId, error: parsed.error.message }, 'Failed to parse Mattermost file info, skipping')
          return null
        }

        const content = await fetchContent(fileId)
        if (content === null) {
          log.warn({ fileId }, 'Mattermost file content fetch returned null, skipping')
          return null
        }

        return {
          fileId,
          filename: parsed.data.name,
          mimeType: parsed.data.mime_type,
          size: parsed.data.size,
          content,
        }
      } catch (error) {
        log.error(
          { fileId, error: error instanceof Error ? error.message : String(error) },
          'Failed to fetch Mattermost file',
        )
        return null
      }
    }),
  )

  return files.filter((file): file is IncomingFile => file !== null)
}

export async function fetchMattermostFileCandidates(
  fileIds: string[],
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
): Promise<IncomingFileCandidate[]> {
  const candidates = await Promise.all(
    fileIds.map(async (fileId): Promise<IncomingFileCandidate | null> => {
      try {
        const infoData = await apiFetch('GET', `/api/v4/files/${fileId}/info`, undefined)
        const parsed = MattermostFileInfoSchema.safeParse(infoData)
        if (!parsed.success) return null
        return {
          fileId,
          filename: parsed.data.name,
          mimeType: parsed.data.mime_type,
          size: parsed.data.size,
        }
      } catch {
        return null
      }
    }),
  )
  return candidates.filter((c): c is IncomingFileCandidate => c !== null)
}

export async function resolveMattermostPostFiles(
  fileIds: string[] | undefined,
  isGroup: boolean,
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
  fetchContent: (fileId: string) => Promise<Buffer | null>,
): Promise<{ files?: IncomingFile[]; fileCandidates?: IncomingFileCandidate[] }> {
  if (fileIds === undefined || fileIds.length === 0) return {}
  if (isGroup) {
    const candidates = await fetchMattermostFileCandidates(fileIds, apiFetch)
    return candidates.length > 0 ? { fileCandidates: candidates } : {}
  }
  const files = await fetchMattermostFiles(fileIds, apiFetch, fetchContent)
  return files.length > 0 ? { files } : {}
}

export function cacheIncomingPost(
  post: MattermostPost,
  replyToMessageId: string | undefined,
  senderName?: string,
): void {
  cacheMessage({
    messageId: post.id,
    contextId: post.channel_id,
    authorId: post.user_id,
    authorUsername: post.user_name ?? senderName,
    text: post.message,
    replyToMessageId,
    timestamp: Date.now(),
  })
}

export function parsePostedEvent(data: Record<string, unknown>): { post: MattermostPost; senderName?: string } | null {
  const postedDataResult = MattermostPostedDataSchema.safeParse(data)
  if (!postedDataResult.success) return null

  const { post: postJson, sender_name: senderName } = postedDataResult.data
  const postResult = MattermostPostSchema.safeParse(JSON.parse(postJson))
  if (!postResult.success) return null
  return { post: postResult.data, senderName }
}

export async function downloadMattermostFile(baseUrl: string, token: string, fileId: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v4/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      log.warn({ fileId, status: res.status }, 'Mattermost file download failed')
      return null
    }

    return Buffer.from(await res.arrayBuffer())
  } catch (error) {
    log.error(
      { fileId, error: error instanceof Error ? error.message : String(error) },
      'Failed to download Mattermost file content',
    )
    return null
  }
}

export async function uploadMattermostFile(
  baseUrl: string,
  token: string,
  channelId: string,
  content: Buffer | string,
  filename: string,
): Promise<string> {
  const body = new FormData()
  const blobContent = typeof content === 'string' ? content : new Uint8Array(content)
  const blob = new Blob([blobContent])
  body.append('files', blob, filename)

  const url = `${baseUrl}/api/v4/files?channel_id=${encodeURIComponent(channelId)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  })
  if (!res.ok) {
    throw new Error(`Mattermost file upload failed: ${res.status}`)
  }

  const data: unknown = await res.json()
  const result = FileUploadSchema.safeParse(data)
  if (!result.success) {
    throw new Error('Invalid file upload response from Mattermost')
  }

  const fileId = result.data.file_infos[0]?.id
  if (fileId === undefined) {
    throw new Error('Mattermost file upload returned no file ID')
  }

  return fileId
}
