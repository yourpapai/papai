// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ShapedPost {
  id?: string
  message?: string
  user_id?: string
  channel_id?: string
  create_at?: number
  update_at?: number
  edit_at?: number
  root_id?: string
  file_ids?: string[]
  // enrichment adds these later (keep optional on the type so the client can attach them):
  user?: { id?: string; username?: string; name?: string }
  attachments?: Array<{
    id?: string
    name?: string
    size?: number
    mime_type?: string
    extension?: string
    create_at?: number
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeBaseUrl(raw: string): string {
  return raw
    .replace(/^wss:\/\//u, 'https://')
    .replace(/^ws:\/\//u, 'http://')
    .replace(/\/+$/u, '')
}

export function extractPostId(linkOrId: string): string {
  return linkOrId.match(/\/pl\/([a-zA-Z0-9]+)/u)?.[1] ?? linkOrId.trim()
}

export function parseSince(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return value
  if (/^\d+$/u.test(value)) return Number(value)
  const t = Date.parse(value)
  if (Number.isNaN(t)) throw new Error('Invalid since value: ' + value)
  return t
}

function shapeFileIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const item of raw) {
    const s = stringOr(item)
    if (s !== undefined) out.push(s)
  }
  return out
}

export function shapePost(raw: unknown): ShapedPost {
  if (!isRecord(raw)) return {}
  const out: ShapedPost = {}
  const id = stringOr(raw['id'])
  if (id !== undefined) out.id = id
  const message = stringOr(raw['message'])
  if (message !== undefined) out.message = message
  const userId = stringOr(raw['user_id'])
  if (userId !== undefined) out.user_id = userId
  const channelId = stringOr(raw['channel_id'])
  if (channelId !== undefined) out.channel_id = channelId
  const rootId = stringOr(raw['root_id'])
  if (rootId !== undefined) out.root_id = rootId
  const createAt = numberOr(raw['create_at'])
  if (createAt !== undefined) out.create_at = createAt
  const updateAt = numberOr(raw['update_at'])
  if (updateAt !== undefined) out.update_at = updateAt
  const editAt = numberOr(raw['edit_at'])
  if (editAt !== undefined) out.edit_at = editAt
  const fileIds = shapeFileIds(raw['file_ids'])
  if (fileIds !== undefined) out.file_ids = fileIds
  return out
}

export function mapOrderedPosts(raw: unknown): ShapedPost[] {
  if (!isRecord(raw) || !isRecord(raw['posts']) || !Array.isArray(raw['order'])) return []
  const posts = raw['posts']
  const order = raw['order']
  const out: ShapedPost[] = []
  for (const id of order) {
    if (typeof id !== 'string') continue
    if (!(id in posts)) continue
    out.push(shapePost(posts[id]))
  }
  return out
}
