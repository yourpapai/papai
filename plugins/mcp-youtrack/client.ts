// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './context.js'
import {
  ACTIVITY_FIELDS,
  ATTACHMENT_FIELDS,
  COMMENT_READ_FIELDS,
  COMMENT_WRITE_FIELDS,
  FIELD_OPTIONS_FIELDS,
  ISSUE_FIELDS,
  shapeActivity,
  shapeAttachment,
  shapeComment,
  shapeFieldOptions,
  shapeIssue,
  type ShapedActivity,
  type ShapedAttachment,
  type ShapedComment,
  type ShapedFieldOption,
  type ShapedIssue,
} from './format.js'
import { createYouTrackRequester, type YouTrackRequester } from './http.js'

export interface YouTrackClientOptions {
  baseUrl: string
  token: string
  httpFetch: HttpFetch
}

export interface ShapedTag {
  id?: string
  name?: string
}

export interface ReadAttachmentResult {
  attachment: ShapedAttachment
  text?: string
  tooLarge?: boolean
  isBinary?: boolean
  note?: string
}

const MAX_INLINE = 512_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function shapeTag(raw: unknown): ShapedTag {
  if (!isRecord(raw)) return {}
  const id = stringOr(raw['id'])
  const name = stringOr(raw['name'])
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
  }
}

export class YouTrackClient {
  private readonly requester: YouTrackRequester

  constructor(options: YouTrackClientOptions) {
    this.requester = createYouTrackRequester(options)
  }

  async getIssue(issueId: string): Promise<ShapedIssue> {
    const raw = await this.requester.request(`/issues/${encodeURIComponent(issueId)}?fields=${ISSUE_FIELDS}`)
    return shapeIssue(raw)
  }

  async getStateActivities(issueId: string): Promise<ShapedActivity[]> {
    const json = await this.requester.request(
      `/issues/${encodeURIComponent(issueId)}/activities?categories=CustomFieldCategory&fields=${ACTIVITY_FIELDS}&$top=500&$orderby=timestamp`,
    )
    const arr = Array.isArray(json) ? json : []
    return arr
      .filter((entry) => isRecord(entry) && isRecord(entry['field']) && entry['field']['name'] === 'State')
      .map((entry) => shapeActivity(entry))
  }

  async getComments(issueId: string): Promise<ShapedComment[]> {
    const json = await this.requester.request(
      `/issues/${encodeURIComponent(issueId)}/comments?fields=${COMMENT_READ_FIELDS}&$top=500`,
    )
    const arr = Array.isArray(json) ? json : []
    return arr.filter((entry) => !(isRecord(entry) && entry['deleted'] === true)).map((entry) => shapeComment(entry))
  }

  async getIssueTags(issueId: string): Promise<ShapedTag[]> {
    const json = await this.requester.request(`/issues/${encodeURIComponent(issueId)}/tags?fields=id,name`)
    return Array.isArray(json) ? json.map((entry) => shapeTag(entry)) : []
  }

  async getFieldOptions(issueId: string, fieldName?: string): Promise<ShapedFieldOption[]> {
    const raw = await this.requester.request(`/issues/${encodeURIComponent(issueId)}?fields=${FIELD_OPTIONS_FIELDS}`)
    return shapeFieldOptions(raw, fieldName)
  }

  async getAttachments(issueId: string): Promise<ShapedAttachment[]> {
    const json = await this.requester.request(
      `/issues/${encodeURIComponent(issueId)}/attachments?fields=${ATTACHMENT_FIELDS}`,
    )
    return Array.isArray(json) ? json.map((entry) => shapeAttachment(entry)) : []
  }

  async readAttachment(issueId: string, attachmentId: string): Promise<ReadAttachmentResult> {
    const meta = await this.requester.request(
      `/issues/${encodeURIComponent(issueId)}/attachments/${encodeURIComponent(attachmentId)}?fields=${ATTACHMENT_FIELDS}`,
    )
    const attachment = shapeAttachment(meta)
    const size = attachment.size ?? 0
    if (size > MAX_INLINE) {
      return { attachment, tooLarge: true }
    }
    if (typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('text/')) {
      const url = isRecord(meta) && typeof meta['url'] === 'string' ? meta['url'] : undefined
      if (url === undefined) {
        return { attachment, isBinary: true, note: 'No download URL' }
      }
      const res = await this.requester.httpFetch(`${this.requester.baseUrl}${url}`, {
        headers: { Authorization: `Bearer ${this.requester.token}`, Accept: '*/*' },
      })
      if (!res.ok) {
        throw new Error(`YouTrack API ${res.status} for attachment content`)
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

  async addComment(issueId: string, text: string): Promise<ShapedComment> {
    const raw = await this.requester.request(
      `/issues/${encodeURIComponent(issueId)}/comments?fields=${COMMENT_WRITE_FIELDS}`,
      {
        method: 'POST',
        body: JSON.stringify({ text }),
      },
    )
    return shapeComment(raw)
  }
}
