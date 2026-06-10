// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity } from 'ai'

import { tryGetEmbedding } from '../../embeddings.js'
import { getSystemConfig } from '../../system-config.js'
import type { ToolBrief } from './tool-brief.js'
import { LexicalToolRetriever, type RankedBrief, type ToolRetriever } from './tool-retriever.js'

export interface EmbeddingRetrieverDeps {
  embed: (text: string) => Promise<number[] | null>
  lexical: ToolRetriever
  cache: Map<string, number[]>
}

export class EmbeddingToolRetriever implements ToolRetriever {
  private readonly deps: EmbeddingRetrieverDeps
  constructor(deps: EmbeddingRetrieverDeps) {
    this.deps = deps
  }

  async rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]> {
    if (query.trim() === '') return []
    const queryVec = await this.deps.embed(query)
    if (queryVec === null) return this.deps.lexical.rank(query, briefs, limit)
    const vecs = await Promise.all(briefs.map((brief) => this.embedBrief(brief)))
    const scored: RankedBrief[] = []
    for (let i = 0; i < briefs.length; i++) {
      const vec = vecs[i]
      if (vec === null || vec === undefined) continue
      if (vec.length !== queryVec.length) continue
      scored.push({ ...briefs[i]!, score: cosineSimilarity(queryVec, vec) })
    }
    if (scored.length === 0) return this.deps.lexical.rank(query, briefs, limit)
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return scored.slice(0, limit)
  }

  private embedBrief(brief: ToolBrief): Promise<number[] | null> {
    const cached = this.deps.cache.get(brief.name)
    if (cached !== undefined) return Promise.resolve(cached)
    return this.deps.embed(`${brief.name}. ${brief.summary} (${brief.domain})`).then((vec) => {
      if (vec !== null) this.deps.cache.set(brief.name, vec)
      return vec
    })
  }
}

const briefEmbeddingCaches = new Map<string, Map<string, number[]>>()

export function getToolRetriever(): ToolRetriever {
  const apiKey = getSystemConfig('llm_apikey')
  const baseUrl = getSystemConfig('llm_baseurl')
  const embeddingModel = getSystemConfig('embedding_model')
  const lexical = new LexicalToolRetriever()
  if (apiKey === null || baseUrl === null || embeddingModel === null) return lexical
  let cache = briefEmbeddingCaches.get(embeddingModel)
  if (cache === undefined) {
    cache = new Map<string, number[]>()
    briefEmbeddingCaches.set(embeddingModel, cache)
  }
  return new EmbeddingToolRetriever({
    embed: (text) => tryGetEmbedding(text, apiKey, baseUrl, embeddingModel),
    lexical,
    cache,
  })
}
