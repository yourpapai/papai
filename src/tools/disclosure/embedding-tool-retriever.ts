// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity } from 'ai'

import { type EmbeddingCallContext, tryGetEmbedding } from '../../embeddings.js'
import { resolveEffectiveLlmConfig } from '../../llm-config-resolver.js'
import { logger } from '../../logger.js'
import type { ToolBrief } from './tool-brief.js'
import { LexicalToolRetriever, type RankedBrief, type ToolRetriever } from './tool-retriever.js'

const log = logger.child({ scope: 'disclosure:embedding-retriever' })

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

  private async safeEmbed(text: string): Promise<number[] | null> {
    try {
      return await this.deps.embed(text)
    } catch (error) {
      log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Embedding call threw; treating as unavailable',
      )
      return null
    }
  }

  async rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]> {
    if (query.trim() === '') return []
    const queryVec = await this.safeEmbed(query)
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
    return this.safeEmbed(`${brief.name}. ${brief.summary} (${brief.domain})`).then((vec) => {
      if (vec !== null) this.deps.cache.set(brief.name, vec)
      return vec
    })
  }
}

const briefEmbeddingCaches = new Map<string, Map<string, number[]>>()

export function clearBriefEmbeddingCachesForTesting(): void {
  briefEmbeddingCaches.clear()
}

export interface ToolRetrieverFactoryDeps {
  resolveConfig: typeof resolveEffectiveLlmConfig
  embedText: typeof tryGetEmbedding
}

const defaultFactoryDeps: ToolRetrieverFactoryDeps = {
  resolveConfig: resolveEffectiveLlmConfig,
  embedText: tryGetEmbedding,
}

export function getToolRetriever(
  configContextId: string,
  callContext: EmbeddingCallContext,
  deps: ToolRetrieverFactoryDeps = defaultFactoryDeps,
): ToolRetriever {
  const lexical = new LexicalToolRetriever()
  const resolved = deps.resolveConfig(configContextId)
  if (!resolved.ok) return lexical
  // Key per endpoint+model: two endpoints can serve the same model name with
  // incompatible vector spaces of equal dimension.
  const cacheKey = `${resolved.llmBaseUrl}:${resolved.embeddingModel}`
  let cache = briefEmbeddingCaches.get(cacheKey)
  if (cache === undefined) {
    cache = new Map<string, number[]>()
    briefEmbeddingCaches.set(cacheKey, cache)
  }
  return new EmbeddingToolRetriever({
    embed: (text) =>
      deps.embedText(text, resolved.llmApiKey, resolved.llmBaseUrl, resolved.embeddingModel, callContext),
    lexical,
    cache,
  })
}
