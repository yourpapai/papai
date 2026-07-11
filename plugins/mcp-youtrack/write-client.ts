// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './context.js'
import { findIssueLink, ISSUE_LINK_FIELDS } from './format-writes.js'
import { createYouTrackRequester, type YouTrackRequester } from './http.js'

export interface YouTrackWriteClientOptions {
  baseUrl: string
  token: string
  httpFetch: HttpFetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export class YouTrackWriteClient {
  private readonly r: YouTrackRequester

  constructor(options: YouTrackWriteClientOptions) {
    this.r = createYouTrackRequester(options)
  }

  private async resolveTagByName(tagName: string): Promise<string> {
    const json = await this.r.getJson(`/tags?fields=id,name&query=${encodeURIComponent(tagName)}`)
    const arr = Array.isArray(json) ? json : []
    const exact = arr.filter((t) => isRecord(t) && t['name'] === tagName)
    if (exact.length === 0) {
      throw new Error(`Tag not found: ${tagName}`)
    }
    if (exact.length > 1) {
      throw new Error(`Ambiguous tag: ${tagName}`)
    }
    const id = isRecord(exact[0]) ? exact[0]['id'] : undefined
    if (typeof id !== 'string') {
      throw new Error(`Tag not found: ${tagName}`)
    }
    return id
  }

  async addIssueTag(issueId: string, tagName: string): Promise<string> {
    const id = await this.resolveTagByName(tagName)
    await this.r.request(`/issues/${encodeURIComponent(issueId)}/tags?fields=id,name`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    })
    return `Tag "${tagName}" added to ${issueId}`
  }

  async removeIssueTag(issueId: string, tagName: string): Promise<string> {
    const id = await this.resolveTagByName(tagName)
    await this.r.request(`/issues/${encodeURIComponent(issueId)}/tags/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return `Tag "${tagName}" removed from ${issueId}`
  }

  async setTags(issueId: string, tags: string[]): Promise<string> {
    const desired = new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))
    const currentJson = await this.r.getJson(`/issues/${encodeURIComponent(issueId)}/tags?fields=id,name`)
    const current = (Array.isArray(currentJson) ? currentJson : [])
      .filter(isRecord)
      .map((t) => ({ id: stringOr(t['id']), name: stringOr(t['name']) }))
    const currentNames = new Set(current.map((t) => t.name).filter((n) => n !== undefined))

    const toAdd = [...desired].filter((name) => !currentNames.has(name))
    await Promise.all(toAdd.map((name) => this.addIssueTag(issueId, name)))

    const toDelete: string[] = []
    for (const t of current) {
      if (t.name !== undefined && !desired.has(t.name) && t.id !== undefined) {
        toDelete.push(t.id)
      }
    }
    await Promise.all(
      toDelete.map((tagId) =>
        this.r.request(`/issues/${encodeURIComponent(issueId)}/tags/${encodeURIComponent(tagId)}`, {
          method: 'DELETE',
        }),
      ),
    )

    return `Tags set on ${issueId}: ${[...desired].sort().join(', ')}`
  }

  async setIssueLink(
    sourceIssueId: string,
    targetIssueId: string,
    linkType: string,
    direction: 'sourceToTarget' | 'targetToSource',
  ): Promise<string> {
    const owning = direction === 'targetToSource' ? targetIssueId : sourceIssueId
    const linkedId = direction === 'targetToSource' ? sourceIssueId : targetIssueId
    const issue = await this.r.getJson(`/issues/${encodeURIComponent(owning)}?fields=${ISSUE_LINK_FIELDS}`)
    const links = isRecord(issue) ? issue['links'] : undefined
    const slot = findIssueLink(links, linkType, direction)
    if (slot === undefined) {
      throw new Error(`Link type not found: ${linkType}`)
    }
    await this.r.request(`/issues/${encodeURIComponent(owning)}/links/${encodeURIComponent(slot.id)}/issues`, {
      method: 'POST',
      body: JSON.stringify({ id: linkedId }),
    })
    return `Link "${linkType}" set between ${sourceIssueId} and ${targetIssueId}`
  }
}
