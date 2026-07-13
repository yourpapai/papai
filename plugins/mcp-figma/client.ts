// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseIds, simplifyFigmaResponse } from './format.js'

export type HttpFetch = (url: string, init: RequestInit | undefined) => Promise<Response>

export interface FigmaClientOptions {
  token: string
  httpFetch: HttpFetch
  baseUrl?: string
}

export type FigmaImageFormat = 'png' | 'svg' | 'pdf'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayOr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export class FigmaClient {
  private readonly tokens: string[]
  private readonly httpFetch: HttpFetch
  private readonly baseUrl: string

  constructor(options: FigmaClientOptions) {
    this.httpFetch = options.httpFetch
    this.baseUrl = (options.baseUrl ?? 'https://api.figma.com').replace(/\/+$/u, '')
    // The context `token` value may carry a comma-separated pool: "tok1,tok2" — rotated on 429.
    this.tokens = options.token
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    if (this.tokens.length === 0) {
      throw new Error('Figma token is empty')
    }
  }

  private request(path: string): Promise<unknown> {
    return this.requestWithToken(path, 0)
  }

  // One attempt per token: on 429 rotate to the next token and retry immediately (no blocking sleep).
  // Recursive (rather than a loop) so the sequential-retry await is not flagged by no-await-in-loop.
  private async requestWithToken(path: string, attempt: number): Promise<unknown> {
    const pool = this.tokens
    if (attempt >= pool.length) {
      throw new Error(`Figma API 429 (rate limited) for ${path}: all ${pool.length} token(s) exhausted`)
    }
    const token = pool[attempt] ?? ''
    const res = await this.httpFetch(`${this.baseUrl}${path}`, {
      headers: {
        'X-Figma-Token': token,
        Accept: 'application/json',
      },
    })
    if (res.ok) {
      return res.json()
    }
    if (res.status === 429) {
      return this.requestWithToken(path, attempt + 1)
    }
    throw new Error(`Figma API ${res.status} for ${path}`)
  }

  async getFile(fileKey: string): Promise<unknown> {
    const json = await this.request(`/v1/files/${encodeURIComponent(fileKey)}`)
    return simplifyFigmaResponse(json)
  }

  async getFileNodes(fileKey: string, idsRaw: string): Promise<unknown> {
    const ids = parseIds(idsRaw)
    const json = await this.request(
      `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${ids.map((id) => encodeURIComponent(id)).join(',')}`,
    )
    return simplifyFigmaResponse(json)
  }

  getImages(fileKey: string, idsRaw: string, format: FigmaImageFormat = 'png', scale?: number): Promise<unknown> {
    const ids = parseIds(idsRaw)
    const scaleParam = format === 'png' && scale !== undefined ? `&scale=${scale}` : ''
    return this.request(
      `/v1/images/${encodeURIComponent(fileKey)}?ids=${ids.map((id) => encodeURIComponent(id)).join(',')}&format=${format}${scaleParam}`,
    )
  }

  async getFileStyles(fileKey: string): Promise<unknown[]> {
    const json = await this.request(`/v1/files/${encodeURIComponent(fileKey)}/styles`)
    return arrayOr(isRecord(json) ? json['styles'] : undefined)
  }

  getStyle(fileKey: string, styleKey: string): Promise<unknown> {
    return this.request(`/v1/files/${encodeURIComponent(fileKey)}/styles/${encodeURIComponent(styleKey)}`)
  }

  async getComponents(fileKey: string): Promise<unknown[]> {
    const json = await this.request(`/v1/files/${encodeURIComponent(fileKey)}/components`)
    return arrayOr(isRecord(json) ? json['components'] : undefined)
  }

  async getComments(fileKey: string): Promise<unknown[]> {
    const json = await this.request(`/v1/files/${encodeURIComponent(fileKey)}/comments`)
    return arrayOr(isRecord(json) ? json['comments'] : undefined)
  }
}
