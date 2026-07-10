// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  simplifyComment,
  simplifyComments,
  simplifyPage,
  type SimplifiedComment,
  type SimplifiedComments,
  type SimplifiedPage,
} from './format.js'

export type HttpFetch = (url: string, init: RequestInit | undefined) => Promise<Response>

export interface ConfluenceClientOptions {
  baseUrl: string
  username: string
  password: string
  httpFetch: HttpFetch
}

export interface ResolvedShortLink {
  resolvedUrl: string
  page: SimplifiedPage
}

const EXPAND = 'body.storage,version,space'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractPageId(loc: string): string | null {
  return loc.match(/[?&]pageId=(\d+)/u)?.[1] ?? loc.match(/\/pages\/(\d+)/u)?.[1] ?? null
}

interface RequestOptions {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export class ConfluenceClient {
  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly httpFetch: HttpFetch

  constructor(options: ConfluenceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.authHeader = 'Basic ' + Buffer.from(`${options.username}:${options.password}`).toString('base64')
    this.httpFetch = options.httpFetch
  }

  private async request(path: string, init?: RequestOptions): Promise<unknown> {
    const res = await this.httpFetch(`${this.baseUrl}/rest/api${path}`, {
      method: init?.method,
      body: init?.body,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
    if (!res.ok) {
      throw new Error(`Confluence API ${res.status} for ${path}`)
    }
    return res.json()
  }

  async getPage(pageId: string): Promise<SimplifiedPage> {
    const json = await this.request(`/content/${encodeURIComponent(pageId)}?expand=${EXPAND}`)
    return simplifyPage(json)
  }

  async getPageByTitle(spaceKey: string, title: string): Promise<SimplifiedPage> {
    const json = await this.request(
      `/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}&expand=${EXPAND}`,
    )
    const results = isRecord(json) && Array.isArray(json['results']) ? json['results'] : []
    if (results.length === 0) {
      throw new Error(`Confluence page not found: spaceKey=${spaceKey}, title=${title}`)
    }
    return simplifyPage(results[0])
  }

  async getComments(pageId: string): Promise<SimplifiedComments> {
    const json = await this.request(`/content/${encodeURIComponent(pageId)}/child/comment?expand=${EXPAND}&limit=100`)
    return simplifyComments(json)
  }

  async addComment(pageId: string, text: string): Promise<SimplifiedComment> {
    const json = await this.request(`/content/${encodeURIComponent(pageId)}/child/comment?expand=${EXPAND}`, {
      method: 'POST',
      body: JSON.stringify({ type: 'comment', body: { storage: { value: text, representation: 'storage' } } }),
    })
    return simplifyComment(json)
  }

  async resolveShortLink(shortLink: string): Promise<ResolvedShortLink> {
    const key = shortLink.includes('/x/')
      ? (shortLink.split('/x/').pop() ?? shortLink).replace(/\/+$/u, '')
      : shortLink.trim()
    if (key === '') {
      throw new Error('Could not extract short-link key')
    }

    const tinyUrl = `${this.baseUrl}/x/${encodeURIComponent(key)}`
    const res = await this.httpFetch(tinyUrl, { headers: { Authorization: this.authHeader } })
    if (!res.ok) {
      throw new Error(`Could not resolve short link "${shortLink}": status ${res.status}`)
    }

    const finalUrl = res.url
    const pageId = extractPageId(finalUrl)
    if (pageId === null) {
      throw new Error(`Could not extract pageId from resolved URL "${finalUrl}"`)
    }

    const page = await this.getPage(pageId)
    return { resolvedUrl: finalUrl, page }
  }
}
