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
  private readonly token: string
  private readonly httpFetch: HttpFetch
  private readonly baseUrl: string

  constructor(options: FigmaClientOptions) {
    this.token = options.token
    this.httpFetch = options.httpFetch
    this.baseUrl = (options.baseUrl ?? 'https://api.figma.com').replace(/\/+$/u, '')
  }

  private async request(path: string): Promise<unknown> {
    const res = await this.httpFetch(`${this.baseUrl}${path}`, {
      headers: {
        'X-Figma-Token': this.token,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(`Figma API ${res.status} for ${path}`)
    }
    return res.json()
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
