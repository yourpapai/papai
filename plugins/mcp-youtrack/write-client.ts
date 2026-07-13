// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './context.js'
import { buildCustomFieldValue, findIssueLink, ISSUE_LINK_FIELDS } from './format-writes.js'
import { ISSUE_FIELDS, shapeIssue } from './format.js'
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

  private async resolveProjectId(project: string): Promise<string> {
    if (/^\d+(-\d+)?$/u.test(project)) {
      return project
    }
    const p = await this.r.getJson(`/admin/projects/${encodeURIComponent(project)}?fields=id`)
    const id = isRecord(p) ? stringOr(p['id']) : undefined
    if (id === undefined) {
      throw new Error(`Project not found: ${project}`)
    }
    return id
  }

  private async resolveFieldTypes(issueId: string): Promise<Map<string, { name: string; type: string }>> {
    const json = await this.r.getJson(`/issues/${encodeURIComponent(issueId)}?fields=customFields(name,$type)`)
    const cf = isRecord(json) && Array.isArray(json['customFields']) ? json['customFields'] : []
    const map = new Map<string, { name: string; type: string }>()
    for (const entry of cf) {
      if (!isRecord(entry)) continue
      const name = stringOr(entry['name'])
      const type = stringOr(entry['$type'])
      if (name === undefined || type === undefined) continue
      map.set(name.toLowerCase(), { name, type })
    }
    return map
  }

  async createIssue(params: {
    project: string
    summary: string
    description?: string
    customFields?: Record<string, unknown>
    referenceIssueId?: string
  }): Promise<unknown> {
    const projectId = await this.resolveProjectId(params.project)
    const body: Record<string, unknown> = { project: { id: projectId }, summary: params.summary }
    if (params.description !== undefined) {
      body['description'] = params.description
    }
    if (params.customFields !== undefined) {
      const { referenceIssueId, customFields } = params
      if (referenceIssueId === undefined) {
        body['customFields'] = Object.entries(customFields).map(([name, value]) => ({ name, value }))
      } else {
        const types = await this.resolveFieldTypes(referenceIssueId)
        body['customFields'] = Object.entries(customFields).map(([name, value]) => {
          const t = types.get(name.toLowerCase())
          return t === undefined
            ? { name, value }
            : { name: t.name, $type: t.type, value: buildCustomFieldValue(t.type, value) }
        })
      }
    }
    const created = await this.r.request(`/issues?fields=${ISSUE_FIELDS}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const shaped = shapeIssue(created)
    if (shaped.summary !== params.summary && shaped.idReadable !== undefined) {
      await this.r.request(`/issues/${encodeURIComponent(shaped.idReadable)}`, {
        method: 'POST',
        body: JSON.stringify({ summary: params.summary }),
      })
      shaped.summary = params.summary
    }
    return shaped
  }

  async updateFields(issueId: string, fields: Record<string, unknown>): Promise<unknown> {
    if (Object.keys(fields).length === 0) {
      throw new Error('No fields to update')
    }
    const types = await this.resolveFieldTypes(issueId)
    const customFields = Object.entries(fields).map(([name, value]) => {
      const t = types.get(name.toLowerCase())
      if (t === undefined) {
        throw new Error(`Unknown field: ${name} (available: ${[...types.values()].map((v) => v.name).join(', ')})`)
      }
      return { name: t.name, $type: t.type, value: buildCustomFieldValue(t.type, value) }
    })
    const updated = await this.r.request(`/issues/${encodeURIComponent(issueId)}?fields=${ISSUE_FIELDS}`, {
      method: 'POST',
      body: JSON.stringify({ customFields }),
    })
    return shapeIssue(updated)
  }
}
