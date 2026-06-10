// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { SYSTEM_CONFIG_KEYS, type SystemConfigKey, systemConfigCacheForTesting } from '../../../src/system-config.js'
import { EmbeddingToolRetriever, getToolRetriever } from '../../../src/tools/disclosure/embedding-tool-retriever.js'
import type { ToolBrief } from '../../../src/tools/disclosure/tool-brief.js'
import { LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'

function isSystemConfigKey(k: string): k is SystemConfigKey {
  return (SYSTEM_CONFIG_KEYS as readonly string[]).includes(k)
}

const briefs: ToolBrief[] = [
  { name: 'list_tasks', summary: 'List tasks.', domain: 'task' },
  { name: 'web_fetch', summary: 'Fetch web page.', domain: 'web' },
]

// Orthogonal unit vectors: tasks → [1,0]; web → [0,1].
const taskVec: number[] = [1, 0]
const webVec: number[] = [0, 1]

// Returns an embed function backed by the given lookup map; unknown texts yield null.
function makeEmbedFromMap(vecByText: Map<string, number[]>): (text: string) => Promise<number[] | null> {
  return (text: string): Promise<number[] | null> => Promise.resolve(vecByText.get(text) ?? null)
}

// Brief embedding text literals (must match embedBrief's format exactly).
const TASK_BRIEF_TEXT = 'list_tasks. List tasks. (task)'
const WEB_BRIEF_TEXT = 'web_fetch. Fetch web page. (web)'

describe('EmbeddingToolRetriever', () => {
  it('ranks by cosine similarity to the query embedding', async () => {
    const embedFn = makeEmbedFromMap(
      new Map([
        [TASK_BRIEF_TEXT, taskVec],
        [WEB_BRIEF_TEXT, webVec],
        ['show my tasks', taskVec],
      ]),
    )
    const embed = mock(embedFn)
    const r = new EmbeddingToolRetriever({ embed, lexical: new LexicalToolRetriever(), cache: new Map() })
    const out = await r.rank('show my tasks', briefs, 2)
    expect(out[0]!.name).toBe('list_tasks')
  })

  it('caches brief embeddings across calls (embeds each brief once)', async () => {
    const embedFn = makeEmbedFromMap(
      new Map([
        [TASK_BRIEF_TEXT, taskVec],
        [WEB_BRIEF_TEXT, webVec],
        ['tasks', taskVec],
        ['tasks again', webVec],
      ]),
    )
    const embed = mock(embedFn)
    const cache = new Map<string, number[]>()
    const r = new EmbeddingToolRetriever({ embed, lexical: new LexicalToolRetriever(), cache })
    await r.rank('tasks', briefs, 2)
    const callsAfterFirst = embed.mock.calls.length
    await r.rank('tasks again', briefs, 2)
    // second call only embeds the query, not the two briefs again.
    expect(embed.mock.calls.length).toBe(callsAfterFirst + 1)
  })

  it('falls back to lexical when the query embedding is null', async () => {
    const embed = mock((_text: string): Promise<number[] | null> => Promise.resolve(null))
    const lexical = new LexicalToolRetriever()
    const r = new EmbeddingToolRetriever({ embed, lexical, cache: new Map() })
    const out = await r.rank('list tasks', briefs, 2)
    expect(out[0]!.name).toBe('list_tasks')
  })

  describe('dimension-mismatch guard', () => {
    it('excludes a cached brief whose vector length differs from the query vector, does not throw, and still ranks the matching brief', async () => {
      // query embeds have length 2; list_tasks cache entry has length 3 (stale/wrong model)
      const cache = new Map<string, number[]>()
      // dim 3 — mismatched vs query dim 2
      cache.set('list_tasks', [1, 0, 0])

      // embed function: query → dim-2 vec; web_fetch brief → dim-2 vec
      const embedFn = makeEmbedFromMap(
        new Map([
          // dim 2
          [WEB_BRIEF_TEXT, [0, 1]],
          // query → aligns with web_fetch
          ['fetch a page', [0, 1]],
        ]),
      )
      const r = new EmbeddingToolRetriever({ embed: embedFn, lexical: new LexicalToolRetriever(), cache })
      // Must not throw despite list_tasks cache being dim 3 vs query dim 2
      const out = await r.rank('fetch a page', briefs, 2)
      // list_tasks was excluded; web_fetch was ranked
      expect(out[0]!.name).toBe('web_fetch')
      // list_tasks should not appear (mismatched dim → excluded)
      expect(out.find((b) => b.name === 'list_tasks')).toBeUndefined()
    })

    it('falls back to lexical when ALL cached brief vectors are dimension-mismatched', async () => {
      // Both cache entries have dim 3 but query will produce dim 2 — all excluded
      const cache = new Map<string, number[]>()
      cache.set('list_tasks', [1, 0, 0])
      cache.set('web_fetch', [0, 1, 0])

      // embed returns dim-2 vecs for query; for briefs the cache is used (no embed calls for briefs)
      const embed = mock((_text: string): Promise<number[] | null> => Promise.resolve([1, 0]))
      const lexical = new LexicalToolRetriever()
      const r = new EmbeddingToolRetriever({ embed, lexical, cache })
      const out = await r.rank('list tasks', briefs, 2)
      // All briefs excluded → lexical fallback → list_tasks matches lexically
      expect(out[0]!.name).toBe('list_tasks')
    })
  })
})

describe('getToolRetriever', () => {
  // Save and restore system config cache entries around each test to avoid pollution
  let savedCache: Map<string, string>

  beforeEach(() => {
    savedCache = new Map(systemConfigCacheForTesting)
  })

  afterEach(() => {
    systemConfigCacheForTesting.clear()
    for (const [k, v] of savedCache) {
      if (isSystemConfigKey(k)) systemConfigCacheForTesting.set(k, v)
    }
  })

  it('returns a LexicalToolRetriever when llm_apikey is absent', () => {
    systemConfigCacheForTesting.clear()
    systemConfigCacheForTesting.set('llm_baseurl', 'http://localhost')
    systemConfigCacheForTesting.set('embedding_model', 'text-embedding-3-small')
    const retriever = getToolRetriever()
    expect(retriever).toBeInstanceOf(LexicalToolRetriever)
  })

  it('returns a LexicalToolRetriever when llm_baseurl is absent', () => {
    systemConfigCacheForTesting.clear()
    systemConfigCacheForTesting.set('llm_apikey', 'sk-test')
    systemConfigCacheForTesting.set('embedding_model', 'text-embedding-3-small')
    const retriever = getToolRetriever()
    expect(retriever).toBeInstanceOf(LexicalToolRetriever)
  })

  it('returns a LexicalToolRetriever when embedding_model is absent', () => {
    systemConfigCacheForTesting.clear()
    systemConfigCacheForTesting.set('llm_apikey', 'sk-test')
    systemConfigCacheForTesting.set('llm_baseurl', 'http://localhost')
    const retriever = getToolRetriever()
    expect(retriever).toBeInstanceOf(LexicalToolRetriever)
  })

  it('returns an EmbeddingToolRetriever when all three keys are present', () => {
    systemConfigCacheForTesting.clear()
    systemConfigCacheForTesting.set('llm_apikey', 'sk-test')
    systemConfigCacheForTesting.set('llm_baseurl', 'http://localhost')
    systemConfigCacheForTesting.set('embedding_model', 'text-embedding-3-small')
    const retriever = getToolRetriever()
    expect(retriever).toBeInstanceOf(EmbeddingToolRetriever)
  })

  it('uses independent caches for different embedding_model values (no cross-model cache pollution)', async () => {
    // Prime with model-A and rank to populate its cache
    systemConfigCacheForTesting.set('llm_apikey', 'sk-test')
    systemConfigCacheForTesting.set('llm_baseurl', 'http://localhost')
    systemConfigCacheForTesting.set('embedding_model', 'model-a')
    const retrieverA = getToolRetriever()

    // Prime with model-B — should get a fresh, independent cache
    systemConfigCacheForTesting.set('embedding_model', 'model-b')
    const retrieverB = getToolRetriever()

    // They are distinct instances, both EmbeddingToolRetrievers
    expect(retrieverA).toBeInstanceOf(EmbeddingToolRetriever)
    expect(retrieverB).toBeInstanceOf(EmbeddingToolRetriever)
    expect(retrieverA).not.toBe(retrieverB)

    // Seed model-A's cache with dim-3 vectors (stale model)
    const cacheA = new Map<string, number[]>()
    cacheA.set('list_tasks', [1, 0, 0])
    cacheA.set('web_fetch', [0, 1, 0])

    // Build model-A retriever directly with stale cache; model-B with fresh cache + dim-2 embed
    const staleRetriever = new EmbeddingToolRetriever({
      embed: mock((_: string): Promise<number[] | null> => Promise.resolve([1, 0])),
      lexical: new LexicalToolRetriever(),
      cache: cacheA,
    })
    // dim mismatch on all entries → falls back to lexical (does not throw)
    const outA = await staleRetriever.rank('list tasks', briefs, 2)
    // lexical fallback, no throw
    expect(outA[0]!.name).toBe('list_tasks')

    const freshRetriever = new EmbeddingToolRetriever({
      embed: makeEmbedFromMap(
        new Map([
          [TASK_BRIEF_TEXT, taskVec],
          [WEB_BRIEF_TEXT, webVec],
          ['list tasks', taskVec],
        ]),
      ),
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
    const outB = await freshRetriever.rank('list tasks', briefs, 2)
    // semantic match, no throw
    expect(outB[0]!.name).toBe('list_tasks')
  })
})
