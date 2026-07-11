// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './context.js'
import type { RagDocument, RagFailure } from './format.js'

export interface RagClientOptions {
  baseUrl: string
  apiKey: string
  contextCodes: string[]
  sources: string[]
  httpFetch: HttpFetch
}

export interface RagSearchResult {
  documents: RagDocument[]
  failures: RagFailure[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toRagDocument(value: unknown): RagDocument | null {
  if (!isRecord(value)) return null
  const document_id = stringOr(value['document_id'])
  const title = stringOr(value['title'])
  const source = stringOr(value['source'])
  const source_type = stringOr(value['source_type'])
  const url = stringOr(value['url'])
  return {
    ...(document_id === undefined ? {} : { document_id }),
    ...(title === undefined ? {} : { title }),
    ...(source === undefined ? {} : { source }),
    ...(source_type === undefined ? {} : { source_type }),
    ...(url === undefined ? {} : { url }),
  }
}

function extractDocuments(json: unknown): RagDocument[] {
  if (!isRecord(json) || !Array.isArray(json['documents'])) return []
  const documents: RagDocument[] = []
  for (const entry of json['documents']) {
    const doc = toRagDocument(entry)
    if (doc !== null) documents.push(doc)
  }
  return documents
}

export class RagClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly contextCodes: string[]
  private readonly sources: string[]
  private readonly httpFetch: HttpFetch

  constructor(options: RagClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.apiKey = options.apiKey
    this.contextCodes = options.contextCodes
    this.sources = options.sources
    this.httpFetch = options.httpFetch
  }

  async search(query: string): Promise<RagSearchResult> {
    const settled = await Promise.allSettled(this.contextCodes.map((code) => this.searchOne(code, query)))

    const documents: RagDocument[] = []
    const failures: RagFailure[] = []
    settled.forEach((result, index) => {
      const contextCode = this.contextCodes[index]
      if (contextCode === undefined) return
      if (result.status === 'fulfilled') {
        documents.push(...result.value)
      } else {
        failures.push({
          contextCode,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    })

    return { documents, failures }
  }

  private async searchOne(contextCode: string, query: string): Promise<RagDocument[]> {
    const res = await this.httpFetch(
      `${this.baseUrl}/v1/rag_contexts/${encodeURIComponent(contextCode)}/search-queries`,
      {
        method: 'POST',
        headers: {
          'X-Kontur-ApiKey': this.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, sources: this.sources }),
      },
    )
    if (!res.ok) {
      throw new Error(`RAG API ${res.status} (context ${contextCode})`)
    }
    const json: unknown = await res.json()
    return extractDocuments(json)
  }
}
