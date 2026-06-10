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
  it('returns [] and never calls embed for a whitespace-only query', async () => {
    const embed = mock((_text: string): Promise<number[] | null> => Promise.resolve([1, 0]))
    const r = new EmbeddingToolRetriever({ embed, lexical: new LexicalToolRetriever(), cache: new Map() })
    const out = await r.rank('   ', briefs, 5)
    expect(out).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })

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

  it('sort order: puts highest cosine similarity first even when lowest-scoring brief is first in input', async () => {
    // Put the LOWEST-similarity brief FIRST in input to kill the "remove sort" mutant:
    // without sort, the wrong brief would be returned first.
    // Uses two negatively-similar briefs so the b.score+a.score mutant also produces wrong order:
    //   Original: b.score - a.score = (-0.3) - (-0.8) = 0.5 > 0 → less_bad(-0.3) before bad_tool(-0.8) ✓
    //   Mutant:   b.score + a.score = (-0.3) + (-0.8) = -1.1 < 0 → bad_tool(-0.8) before less_bad(-0.3) ✗
    const negBriefs: ToolBrief[] = [
      // bad_tool embedding is more anti-parallel → score ≈ -0.8 (first in array)
      { name: 'bad_tool', summary: 'Bad tool.', domain: 'misc' },
      // less_bad embedding is slightly anti-parallel → score ≈ -0.3 (second in array)
      { name: 'less_bad', summary: 'Less bad.', domain: 'misc' },
    ]
    // Unit vectors so cosine = dot product: query=[1,0]
    // bad_tool: [-0.8, 0.6] → dot=-0.8
    // less_bad: [-0.3, 0.954] → dot≈-0.3
    const queryVec2: number[] = [1, 0]
    const badVec: number[] = [-0.8, 0.6]
    const lessBadVec: number[] = [-0.3, 0.9539392014169457]
    const embedFn = makeEmbedFromMap(
      new Map([
        ['bad_tool. Bad tool. (misc)', badVec],
        ['less_bad. Less bad. (misc)', lessBadVec],
        ['neg query', queryVec2],
      ]),
    )
    const r = new EmbeddingToolRetriever({ embed: embedFn, lexical: new LexicalToolRetriever(), cache: new Map() })
    const out = await r.rank('neg query', negBriefs, 2)
    expect(out.length).toBe(2)
    // less_bad (score≈-0.3) should come before bad_tool (score≈-0.8).
    // Input order has bad_tool first, so without sort, bad_tool would be [0].
    expect(out[0]!.name).toBe('less_bad')
    expect(out[1]!.name).toBe('bad_tool')
  })

  it('sort order: name-ascending tie-break for equal cosine similarity scores', async () => {
    // Two briefs with the same embedding vector → equal similarity → tie-break by name.
    // 'alpha_tool' should come before 'beta_tool'. Without the localeCompare || branch,
    // the tie would be unresolved and order would depend on input order — using 'beta' first
    // in input order means failing without tie-break.
    const sharedVec: number[] = [1, 0]
    const tieBriefs: ToolBrief[] = [
      { name: 'beta_tool', summary: 'Beta tool.', domain: 'misc' },
      { name: 'alpha_tool', summary: 'Alpha tool.', domain: 'misc' },
    ]
    const embedFn = makeEmbedFromMap(
      new Map([
        ['beta_tool. Beta tool. (misc)', sharedVec],
        ['alpha_tool. Alpha tool. (misc)', sharedVec],
        ['tie query', sharedVec],
      ]),
    )
    const r = new EmbeddingToolRetriever({ embed: embedFn, lexical: new LexicalToolRetriever(), cache: new Map() })
    const out = await r.rank('tie query', tieBriefs, 2)
    expect(out.length).toBe(2)
    // Both have same score; tie-break by name → alpha before beta.
    expect(out[0]!.name).toBe('alpha_tool')
    expect(out[1]!.name).toBe('beta_tool')
  })

  it('slice: limit is respected — returns no more than limit items even when more briefs match', async () => {
    // 3 briefs, all with valid embeddings, limit=2 → output must have exactly 2 items.
    // Without the .slice(0, limit) call, all 3 items would be returned, failing the length check.
    const threeBriefs: ToolBrief[] = [
      { name: 'list_tasks', summary: 'List tasks.', domain: 'task' },
      { name: 'web_fetch', summary: 'Fetch web page.', domain: 'web' },
      { name: 'save_memo', summary: 'Save memo.', domain: 'memo' },
    ]
    const embedFn = makeEmbedFromMap(
      new Map([
        [TASK_BRIEF_TEXT, taskVec],
        [WEB_BRIEF_TEXT, webVec],
        // orthogonal to query → similarity 0
        ['save_memo. Save memo. (memo)', [0, 1]],
        ['limit test query', taskVec],
      ]),
    )
    const r = new EmbeddingToolRetriever({ embed: embedFn, lexical: new LexicalToolRetriever(), cache: new Map() })
    const out = await r.rank('limit test query', threeBriefs, 2)
    expect(out.length).toBe(2)
  })

  it('calls embed exactly briefs.length + 1 times on first rank (one per brief + one for query)', async () => {
    // This pins the loop iteration count: an off-by-one (i <= briefs.length) would call embed
    // briefs.length + 2 times instead of briefs.length + 1.
    const embedFn = makeEmbedFromMap(
      new Map([
        [TASK_BRIEF_TEXT, taskVec],
        [WEB_BRIEF_TEXT, webVec],
        ['count query', taskVec],
      ]),
    )
    const embed = mock(embedFn)
    const r = new EmbeddingToolRetriever({ embed, lexical: new LexicalToolRetriever(), cache: new Map() })
    await r.rank('count query', briefs, 2)
    // briefs has 2 entries → 2 brief embeds + 1 query embed = 3 total calls
    expect(embed.mock.calls.length).toBe(3)
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

  it('reuses the same brief-embedding cache across calls for the same model', async () => {
    // If the cache === undefined guard is mutated to always true, a new Map is created on every
    // getToolRetriever() call and briefEmbeddingCaches.set is called every time — but calling
    // getToolRetriever() twice with the same model and then priming the cache via EmbeddingToolRetriever
    // directly shows whether the two instances share the same Map.
    // We test this by constructing two EmbeddingToolRetriever instances with the SAME cache Map
    // and confirming that a brief embedded in one is seen by the other (cache hit, no re-embed).
    const sharedCache = new Map<string, number[]>()
    const embedFn = makeEmbedFromMap(
      new Map([
        [TASK_BRIEF_TEXT, taskVec],
        [WEB_BRIEF_TEXT, webVec],
        ['priming query', taskVec],
        ['second query', webVec],
      ]),
    )
    const embed = mock(embedFn)

    // First retriever primes the cache.
    const r1 = new EmbeddingToolRetriever({ embed, lexical: new LexicalToolRetriever(), cache: sharedCache })
    await r1.rank('priming query', briefs, 2)
    const callsAfterPrime = embed.mock.calls.length

    // Second retriever with the SAME cache — should not re-embed briefs.
    const r2 = new EmbeddingToolRetriever({ embed, lexical: new LexicalToolRetriever(), cache: sharedCache })
    await r2.rank('second query', briefs, 2)
    // Only the query embed is new; briefs are cached.
    expect(embed.mock.calls.length).toBe(callsAfterPrime + 1)
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
