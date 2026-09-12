// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity } from 'ai'
import pLimit from 'p-limit'

import { type EmbeddingCallContext, embedManyTexts, tryGetEmbedding } from '../../embeddings.js'
import { resolveLlmConfig } from '../../llm-providers/resolver.js'
import { logger } from '../../logger.js'
import { toolErrorClass } from '../tool-logging.js'
import type { ToolBrief } from './tool-brief.js'
import { LexicalToolRetriever, type RankedBrief, type ToolRetriever } from './tool-retriever.js'

const log = logger.child({ scope: 'disclosure:embedding-retriever' })

/** Joining a warm-up never propagates its failure: chunk errors are handled inside the batch. */
const swallow = (): void => undefined

/** Max brief texts per one batched embedding request. */
export const BATCH_CHUNK = 32
/** Concurrent batched embedding requests during one warm-up. */
export const BATCH_CONCURRENCY = 2
/** A brief whose embedding failed is not re-embedded until this TTL elapses. */
export const FAILURE_TTL_MS = 60_000

/** Shared per endpoint+model join point for in-flight warm-ups. */
export interface WarmupJoin {
  current: Promise<void> | undefined
}

export interface EmbeddingRetrieverDeps {
  embed: (text: string) => Promise<number[] | null>
  embedMany: (texts: readonly string[]) => Promise<number[][]>
  lexical: ToolRetriever
  cache: Map<string, number[]>
  warmup?: WarmupJoin
  failures?: Map<string, number>
  failureTtlMs?: number
  now?: () => number
}

interface ResolvedDeps {
  readonly embed: (text: string) => Promise<number[] | null>
  readonly embedMany: (texts: readonly string[]) => Promise<number[][]>
  readonly lexical: ToolRetriever
  readonly cache: Map<string, number[]>
  readonly warmup: WarmupJoin
  readonly failures: Map<string, number>
  readonly failureTtlMs: number
  readonly now: () => number
}

const resolveDeps = (deps: EmbeddingRetrieverDeps): ResolvedDeps => ({
  embed: deps.embed,
  embedMany: deps.embedMany,
  lexical: deps.lexical,
  cache: deps.cache,
  warmup: deps.warmup ?? { current: undefined },
  failures: deps.failures ?? new Map<string, number>(),
  failureTtlMs: deps.failureTtlMs ?? FAILURE_TTL_MS,
  now: deps.now ?? Date.now,
})

export class EmbeddingToolRetriever implements ToolRetriever {
  private readonly deps: ResolvedDeps
  constructor(deps: EmbeddingRetrieverDeps) {
    this.deps = resolveDeps(deps)
  }

  private async safeEmbed(text: string): Promise<number[] | null> {
    try {
      return await this.deps.embed(text)
    } catch (error) {
      log.warn({ errorClass: toolErrorClass(error) }, 'Embedding call threw; treating as unavailable')
      return null
    }
  }

  async rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]> {
    if (query.trim() === '') return []
    const queryVec = await this.safeEmbed(query)
    if (queryVec === null) return this.deps.lexical.rank(query, briefs, limit)
    await this.ensureBriefVectors(briefs)
    const scored: RankedBrief[] = []
    for (const brief of briefs) {
      const vec = this.deps.cache.get(brief.name)
      if (vec === undefined) continue
      if (vec.length !== queryVec.length) continue
      scored.push({ ...brief, score: cosineSimilarity(queryVec, vec) })
    }
    if (scored.length === 0) return this.deps.lexical.rank(query, briefs, limit)
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return scored.slice(0, limit)
  }

  private briefText(brief: ToolBrief): string {
    return `${brief.name}. ${brief.summary} (${brief.domain})`
  }

  private failedRecently(name: string): boolean {
    const failedAt = this.deps.failures.get(name)
    if (failedAt === undefined) return false
    return this.deps.now() - failedAt < this.deps.failureTtlMs
  }

  private missingBriefs(briefs: readonly ToolBrief[]): ToolBrief[] {
    return briefs.filter((brief) => !this.deps.cache.has(brief.name) && !this.failedRecently(brief.name))
  }

  /**
   * Warms the cache for the given briefs, joining any in-flight warm-up first,
   * so concurrent searches never embed the same brief text concurrently. Bounded
   * to one join plus one own warm-up.
   */
  private async ensureBriefVectors(briefs: readonly ToolBrief[]): Promise<void> {
    const existing = this.deps.warmup.current
    if (existing !== undefined) await existing.catch(swallow)
    if (this.missingBriefs(briefs).length === 0) return
    await this.runOwnWarmup(briefs)
  }

  private async runOwnWarmup(briefs: readonly ToolBrief[]): Promise<void> {
    const started = this.deps.warmup.current
    if (started !== undefined) {
      await started.catch(swallow)
      return
    }
    const missing = this.missingBriefs(briefs)
    if (missing.length === 0) return
    const flight = this.warmBatch(missing).catch(swallow)
    this.deps.warmup.current = flight
    try {
      await flight
    } finally {
      if (this.deps.warmup.current === flight) this.deps.warmup.current = undefined
    }
  }

  private async warmBatch(missing: readonly ToolBrief[]): Promise<void> {
    const limit = pLimit(BATCH_CONCURRENCY)
    const chunks: ToolBrief[][] = []
    for (let i = 0; i < missing.length; i += BATCH_CHUNK) {
      chunks.push(missing.slice(i, i + BATCH_CHUNK))
    }
    await Promise.all(
      chunks.map((chunk) =>
        limit(() =>
          this.deps
            .embedMany(chunk.map((brief) => this.briefText(brief)))
            .then((vectors) => {
              for (const [idx, brief] of chunk.entries()) {
                const vec = vectors[idx]
                if (vec === undefined) continue
                this.deps.cache.set(brief.name, vec)
                this.deps.failures.delete(brief.name)
              }
              log.debug({ embedded: chunk.length }, 'Brief batch embedded')
            })
            .catch((error: unknown) => {
              log.warn(
                { errorClass: toolErrorClass(error), count: chunk.length },
                'Brief batch failed; tombstoning chunk for the failure TTL',
              )
              const failedAt = this.deps.now()
              for (const brief of chunk) this.deps.failures.set(brief.name, failedAt)
            }),
        ),
      ),
    )
  }
}

const briefEmbeddingCaches = new Map<string, Map<string, number[]>>()
const briefWarmupJoins = new Map<string, WarmupJoin>()
const briefFailureMaps = new Map<string, Map<string, number>>()

export function clearBriefEmbeddingCachesForTesting(): void {
  briefEmbeddingCaches.clear()
  briefWarmupJoins.clear()
  briefFailureMaps.clear()
}

export interface ToolRetrieverFactoryDeps {
  resolveConfig: typeof resolveLlmConfig
  embedText: typeof tryGetEmbedding
  embedTexts: typeof embedManyTexts
}

const defaultFactoryDeps: ToolRetrieverFactoryDeps = {
  resolveConfig: resolveLlmConfig,
  embedText: tryGetEmbedding,
  embedTexts: embedManyTexts,
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
  const cacheKey = `${resolved.embedding.baseUrl}:${resolved.embedding.model}`
  let cache = briefEmbeddingCaches.get(cacheKey)
  if (cache === undefined) {
    cache = new Map<string, number[]>()
    briefEmbeddingCaches.set(cacheKey, cache)
  }
  let warmup = briefWarmupJoins.get(cacheKey)
  if (warmup === undefined) {
    warmup = { current: undefined }
    briefWarmupJoins.set(cacheKey, warmup)
  }
  let failures = briefFailureMaps.get(cacheKey)
  if (failures === undefined) {
    failures = new Map<string, number>()
    briefFailureMaps.set(cacheKey, failures)
  }
  return new EmbeddingToolRetriever({
    embed: (text) =>
      deps.embedText(
        text,
        resolved.embedding.apiKey,
        resolved.embedding.baseUrl,
        resolved.embedding.model,
        callContext,
      ),
    embedMany: (texts) =>
      deps.embedTexts(
        texts,
        resolved.embedding.apiKey,
        resolved.embedding.baseUrl,
        resolved.embedding.model,
        callContext,
      ),
    lexical,
    cache,
    warmup,
    failures,
  })
}
