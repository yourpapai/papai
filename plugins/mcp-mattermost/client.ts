// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './context.js'
import { extractPostId, mapOrderedPosts, normalizeBaseUrl, parseSince, shapePost, type ShapedPost } from './format.js'

export interface MattermostUser {
  id?: string
  username?: string
  name?: string
}

export interface MattermostFileInfo {
  id?: string
  name?: string
  size?: number
  mime_type?: string
  extension?: string
  create_at?: number
}

export interface MattermostClientOptions {
  baseUrl: string
  token: string
  httpFetch: HttpFetch
}

export interface ChannelPostsResult {
  channel_id: string
  page?: number
  per_page?: number
  since?: number
  order: string[]
  posts: ShapedPost[]
}

export interface CreatePostParams {
  channelId: string
  message: string
  rootId?: string
  threadLinkOrId?: string
}

export interface DownloadAttachmentResult {
  attachment: MattermostFileInfo
  text?: string
  tooLarge?: boolean
  isBinary?: boolean
  note?: string
}

interface RequestOptions {
  method?: string
  body?: string
  headers?: Record<string, string>
}

const MAX_INLINE_ATTACHMENT_BYTES = 512_000
const DEFAULT_PER_PAGE = 60
const MAX_PER_PAGE = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (value === undefined || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export class MattermostClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly httpFetch: HttpFetch

  constructor(options: MattermostClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.token = options.token
    this.httpFetch = options.httpFetch
  }

  private async request(path: string, init?: RequestOptions): Promise<unknown> {
    const res = await this.httpFetch(`${this.baseUrl}/api/v4${path}`, {
      method: init?.method,
      body: init?.body,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      throw new Error(`Mattermost API ${res.status} for ${path}`)
    }
    return res.json()
  }

  private async fetchUser(userId: string): Promise<MattermostUser | undefined> {
    try {
      const raw = await this.request(`/users/${encodeURIComponent(userId)}`)
      if (!isRecord(raw)) return undefined
      const id = stringOr(raw['id'])
      const username = stringOr(raw['username'])
      const firstName = stringOr(raw['first_name'])
      const lastName = stringOr(raw['last_name'])
      const nickname = stringOr(raw['nickname'])
      const fullName = [firstName, lastName].filter((part) => part !== undefined && part !== '').join(' ')
      const name = fullName === '' ? (nickname ?? username ?? '') : fullName
      return { id, username, name }
    } catch {
      return undefined
    }
  }

  private async parseFileInfo(fileId: string): Promise<MattermostFileInfo> {
    const raw = await this.request(`/files/${encodeURIComponent(fileId)}/info`)
    const record = isRecord(raw) ? raw : {}
    const info: MattermostFileInfo = {}
    const id = stringOr(record['id'])
    if (id !== undefined) info.id = id
    const name = stringOr(record['name'])
    if (name !== undefined) info.name = name
    const mimeType = stringOr(record['mime_type'])
    if (mimeType !== undefined) info.mime_type = mimeType
    const extension = stringOr(record['extension'])
    if (extension !== undefined) info.extension = extension
    const size = numberOr(record['size'])
    if (size !== undefined) info.size = size
    const createAt = numberOr(record['create_at'])
    if (createAt !== undefined) info.create_at = createAt
    return info
  }

  private async fetchFileInfo(fileId: string): Promise<MattermostFileInfo | undefined> {
    try {
      return await this.parseFileInfo(fileId)
    } catch {
      return undefined
    }
  }

  private async enrichPosts(posts: ShapedPost[]): Promise<ShapedPost[]> {
    const userIds = uniqueDefined(posts.map((post) => post.user_id))
    const fileIds = uniqueDefined(posts.flatMap((post) => post.file_ids ?? []))

    const userResults = await Promise.all(userIds.map((id) => this.fetchUser(id)))
    const userMap = new Map<string, MattermostUser>()
    for (const [index, id] of userIds.entries()) {
      const user = userResults[index]
      if (user !== undefined) userMap.set(id, user)
    }

    const fileResults = await Promise.all(fileIds.map((id) => this.fetchFileInfo(id)))
    const fileMap = new Map<string, MattermostFileInfo>()
    for (const [index, id] of fileIds.entries()) {
      const info = fileResults[index]
      if (info !== undefined) fileMap.set(id, info)
    }

    return posts.map((post) => {
      const attachments = (post.file_ids ?? [])
        .map((id) => fileMap.get(id))
        .filter((info): info is MattermostFileInfo => info !== undefined)
      const user = post.user_id === undefined ? undefined : userMap.get(post.user_id)
      return {
        ...post,
        ...(user === undefined ? {} : { user }),
        ...(attachments.length > 0 ? { attachments } : {}),
      }
    })
  }

  private async enrichOne(post: ShapedPost): Promise<ShapedPost> {
    const [enriched] = await this.enrichPosts([post])
    if (enriched === undefined) {
      throw new Error('Mattermost post enrichment produced no result')
    }
    return enriched
  }

  async getPost(linkOrId: string): Promise<ShapedPost> {
    const id = extractPostId(linkOrId)
    const raw = await this.request(`/posts/${encodeURIComponent(id)}`)
    return this.enrichOne(shapePost(raw))
  }

  async getThread(linkOrId: string): Promise<ShapedPost[]> {
    const id = extractPostId(linkOrId)
    const raw = await this.request(`/posts/${encodeURIComponent(id)}/thread`)
    return this.enrichPosts(mapOrderedPosts(raw))
  }

  async getChannelPosts(
    channelId: string,
    opts: { since?: string | number; page?: number; perPage?: number },
  ): Promise<ChannelPostsResult> {
    const since = opts.since === undefined ? undefined : parseSince(opts.since)
    const page = opts.page ?? 0
    const perPage = Math.min(opts.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE)
    const query = since === undefined ? `page=${page}&per_page=${perPage}` : `since=${since}`

    const raw = await this.request(`/channels/${encodeURIComponent(channelId)}/posts?${query}`)
    const sorted = mapOrderedPosts(raw).sort((a, b) => (a.create_at ?? 0) - (b.create_at ?? 0))
    const posts = await this.enrichPosts(sorted)
    const order = posts.map((post) => post.id).filter((id): id is string => id !== undefined)

    return {
      channel_id: channelId,
      ...(since === undefined ? { page, per_page: perPage } : { since }),
      order,
      posts,
    }
  }

  async createPost(params: CreatePostParams): Promise<ShapedPost> {
    const threadRootId = params.threadLinkOrId === undefined ? undefined : extractPostId(params.threadLinkOrId)
    const rootId = params.rootId ?? threadRootId
    const body = {
      channel_id: params.channelId,
      message: params.message,
      ...(rootId === undefined ? {} : { root_id: rootId }),
    }
    const raw = await this.request('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return this.enrichOne(shapePost(raw))
  }

  async downloadAttachment(fileId: string): Promise<DownloadAttachmentResult> {
    const attachment = await this.parseFileInfo(fileId)
    const size = attachment.size ?? 0
    if (size > MAX_INLINE_ATTACHMENT_BYTES) {
      return { attachment, tooLarge: true }
    }
    if (typeof attachment.mime_type === 'string' && attachment.mime_type.startsWith('text/')) {
      const res = await this.httpFetch(`${this.baseUrl}/api/v4/files/${encodeURIComponent(fileId)}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: '*/*' },
      })
      if (!res.ok) {
        throw new Error(`Mattermost API ${res.status} for /files/${fileId}`)
      }
      const text = await res.text()
      return { attachment, text }
    }
    return {
      attachment,
      isBinary: true,
      note: 'Binary attachment; content not inlined (no filesystem handoff in this MCP transport).',
    }
  }
}
