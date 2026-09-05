// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { EmbeddingCallContext } from '../../../src/embeddings.js'
import type { LlmConfigResult } from '../../../src/llm-providers/types.js'
import {
  EmbeddingToolRetriever,
  getToolRetriever,
  type ToolRetrieverFactoryDeps,
  type WarmupJoin,
} from '../../../src/tools/disclosure/embedding-tool-retriever.js'
import { clearBriefEmbeddingCachesForTesting } from '../../../src/tools/disclosure/embedding-tool-retriever.testing.js'
import type { ToolBrief } from '../../../src/tools/disclosure/tool-brief.js'
import { LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

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

// Brief embedding text literals (must match briefText's format exactly).
const TASK_BRIEF_TEXT = 'list_tasks. List tasks. (task)'
const WEB_BRIEF_TEXT = 'web_fetch. Fetch web page. (web)'

// Inert batch stub: resolves no vectors; unexpected calls are observable via call counts.
function inertEmbedMany(): (texts: readonly string[]) => Promise<number[][]> {
  return (_texts: readonly string[]): Promise<number[][]> => Promise.resolve([])
}

// Batch stub from a lookup map: one call per chunk; unknown texts throw (chunk failure).
function makeEmbedManyFromMap(vecByText: Map<string, number[]>): (texts: readonly string[]) => Promise<number[][]> {
  return (texts: readonly string[]): Promise<number[][]> =>
    Promise.resolve(
      texts.map((text) => {
        const vec = vecByText.get(text)
        if (vec === undefined) throw new Error('unknown brief text')
        return vec
      }),
    )
}

// Batch stub whose first call rejects; later calls resolve the given vector for every text.
function failFirstThenSucceedEmbedMany(
  failure: Error,
  vec: number[],
): (texts: readonly string[]) => Promise<number[][]> {
  let calls = 0
  return (texts: readonly string[]): Promise<number[][]> => {
    calls += 1
    if (calls === 1) return Promise.reject(failure)
    return Promise.resolve(texts.map(() => vec))
  }
}

// Batch stub whose first call returns a short vector array (omitting the tail briefs).
function shortFirstBatchEmbedMany(vec: number[]): (texts: readonly string[]) => Promise<number[][]> {
  let calls = 0
  return (texts: readonly string[]): Promise<number[][]> => {
    calls += 1
    if (calls === 1) return Promise.resolve([vec])
    return Promise.resolve(texts.map(() => vec))
  }
}

// Batch stub that rejects small chunks (the tail chunk) and resolves large ones.
function rejectTailChunks(vec: number[], tailChunkMax: number): (texts: readonly string[]) => Promise<number[][]> {
  return (texts: readonly string[]): Promise<number[][]> => {
    if (texts.length <= tailChunkMax) return Promise.reject(new Error('tail chunk down'))
    return Promise.resolve(texts.map(() => vec))
  }
}

// Drains a fixed number of microtask ticks deterministically (no wall-clock waits).
const drainTicks = async (ticks: number): Promise<void> => {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

// Drains microtasks until cond() holds; bounded so a never-true condition fails loudly.
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await Promise.resolve()
  expect(cond()).toBe(true)
}

describe('batched brief embedding', () => {
  const makeBriefs = (count: number): ToolBrief[] =>
    Array.from({ length: count }, (_, i) => ({ name: `tool_${i}`, summary: `Tool number ${i}.`, domain: 'misc' }))

  it('cold rank sends all brief texts through embedMany in chunks of at most 32; embed only for the query', async () => {
    const briefs75 = makeBriefs(75)
    const embedManyCalls: string[][] = []
    let queryEmbedCalls = 0
    const embed = mock((_text: string): Promise<number[] | null> => {
      queryEmbedCalls += 1
      return Promise.resolve([1, 0])
    })
    const embedMany = mock((texts: readonly string[]): Promise<number[][]> => {
      embedManyCalls.push([...texts])
      return Promise.resolve(texts.map(() => [1, 0]))
    })
    const r = new EmbeddingToolRetriever({ embed, embedMany, lexical: new LexicalToolRetriever(), cache: new Map() })

    const out = await r.rank('find tools', briefs75, 5)

    expect(queryEmbedCalls).toBe(1)
    expect(embedManyCalls.length).toBe(3)
    // 75 briefs → 32 + 32 + 11
    for (const chunk of embedManyCalls) expect(chunk.length).toBeLessThanOrEqual(32)
    expect(embedManyCalls.flat().length).toBe(75)
    expect(out.length).toBe(5)
  })

  it('an exact multiple of the chunk size yields exactly count/32 full chunks with no empty tail', async () => {
    const briefs64 = makeBriefs(64)
    const embedManyCalls: string[][] = []
    const embedMany = mock((texts: readonly string[]): Promise<number[][]> => {
      embedManyCalls.push([...texts])
      return Promise.resolve(texts.map(() => [1, 0]))
    })
    const r = new EmbeddingToolRetriever({
      embed: mock((_text: string): Promise<number[] | null> => Promise.resolve([1, 0])),
      embedMany,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })

    await r.rank('find tools', briefs64, 5)

    expect(embedManyCalls.length).toBe(2)
    expect(embedManyCalls[0]?.length).toBe(32)
    expect(embedManyCalls[1]?.length).toBe(32)
  })

  it('warm rank issues no brief-embedding calls (query embed only)', async () => {
    const cache = new Map<string, number[]>([
      ['list_tasks', taskVec],
      ['web_fetch', webVec],
    ])
    const embed = mock((_text: string): Promise<number[] | null> => Promise.resolve(taskVec))
    const embedMany = mock((_texts: readonly string[]): Promise<number[][]> => {
      throw new Error('embedMany must not be called on a warm cache')
    })
    const r = new EmbeddingToolRetriever({ embed, embedMany, lexical: new LexicalToolRetriever(), cache })

    const out = await r.rank('show my tasks', briefs, 2)

    expect(embedMany.mock.calls.length).toBe(0)
    expect(embed.mock.calls.length).toBe(1)
    expect(out[0]!.name).toBe('list_tasks')
  })
})

describe('single-flight warm-up', () => {
  it('concurrent ranks on a cold cache share one batch; the second joins instead of re-embedding', async () => {
    const embedManyCalls: string[][] = []
    const pendingReleases: Array<() => void> = []
    let queryEmbeds = 0
    const embed = mock((_text: string): Promise<number[] | null> => {
      queryEmbeds += 1
      return Promise.resolve(taskVec)
    })
    const embedMany = mock((texts: readonly string[]): Promise<number[][]> => {
      embedManyCalls.push([...texts])
      return new Promise((resolve) => {
        pendingReleases.push((): void => resolve(texts.map(() => taskVec)))
      })
    })
    const shared = { cache: new Map<string, number[]>(), warmup: { current: undefined } as WarmupJoin }
    const makeRetriever = (): EmbeddingToolRetriever =>
      new EmbeddingToolRetriever({
        embed,
        embedMany,
        lexical: new LexicalToolRetriever(),
        cache: shared.cache,
        warmup: shared.warmup,
      })

    const rankA = makeRetriever().rank('query a', briefs, 2)
    await until(() => embedManyCalls.length === 1)
    const rankB = makeRetriever().rank('query b', briefs, 2)
    // B started and embedded its query
    await until(() => queryEmbeds === 2)
    // Deterministic microtask drain: B must now either park in its own batch call
    // (pre-fix) or join A's in-flight warm-up (post-fix) before anything is released.
    await drainTicks(50)

    for (const release of pendingReleases) release()
    await Promise.all([rankA, rankB])

    expect(embedManyCalls.length).toBe(1)
    // B joined A's in-flight batch — no duplicate texts sent
  })
})

describe('failure TTL', () => {
  it('does not re-request a failed batch within the TTL; retries after it elapses', async () => {
    let clock = 1_000
    const embedManyCalls: string[][] = []
    const embedMany = mock(failFirstThenSucceedEmbedMany(new Error('throttled'), taskVec))
    const r = new EmbeddingToolRetriever({
      embed: mock((_text: string): Promise<number[] | null> => Promise.resolve(taskVec)),
      embedMany: (texts: readonly string[]): Promise<number[][]> => {
        embedManyCalls.push([...texts])
        return embedMany(texts)
      },
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
      failureTtlMs: 60_000,
      now: (): number => clock,
    })

    const first = await r.rank('tasks query', briefs, 2)
    // lexical fallback answers despite the failure
    expect(first.length).toBeGreaterThan(0)
    expect(embedManyCalls.length).toBe(1)

    const second = await r.rank('tasks query two', briefs, 2)
    expect(embedManyCalls.length).toBe(1)
    // tombstoned within the TTL — no re-request
    expect(second.length).toBeGreaterThan(0)

    clock += 60_000
    await r.rank('tasks query three', briefs, 2)
    expect(embedManyCalls.length).toBe(2)
    // TTL elapsed — the brief batch is retried
  })

  it('defaults to the 60s TTL and compares now minus failedAt', async () => {
    let clock = 100_000
    const embedMany = mock(failFirstThenSucceedEmbedMany(new Error('throttled'), taskVec))
    const r = new EmbeddingToolRetriever({
      embed: mock((_text: string): Promise<number[] | null> => Promise.resolve(taskVec)),
      embedMany,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
      now: (): number => clock,
    })

    await r.rank('first query', briefs, 2)
    expect(embedMany.mock.calls.length).toBe(1)

    // 1 ms after the failure: now - failedAt is far below the default 60s TTL
    clock += 1
    await r.rank('second query', briefs, 2)
    expect(embedMany.mock.calls.length).toBe(1)

    clock += 60_000
    await r.rank('third query', briefs, 2)
    expect(embedMany.mock.calls.length).toBe(2)
  })
})

describe('EmbeddingToolRetriever', () => {
  it('returns [] and never calls embed for a whitespace-only query', async () => {
    const embed = mock((_text: string): Promise<number[] | null> => Promise.resolve([1, 0]))
    const embedMany = mock(inertEmbedMany())
    const r = new EmbeddingToolRetriever({ embed, embedMany, lexical: new LexicalToolRetriever(), cache: new Map() })
    const out = await r.rank('   ', briefs, 5)
    expect(out).toEqual([])
    expect(embed).not.toHaveBeenCalled()
    expect(embedMany).not.toHaveBeenCalled()
  })

  it('ranks by cosine similarity to the query embedding', async () => {
    const embedFn = makeEmbedFromMap(new Map([['show my tasks', taskVec]]))
    const embed = mock(embedFn)
    const embedMany = mock(
      makeEmbedManyFromMap(
        new Map([
          [TASK_BRIEF_TEXT, taskVec],
          [WEB_BRIEF_TEXT, webVec],
        ]),
      ),
    )
    const r = new EmbeddingToolRetriever({ embed, embedMany, lexical: new LexicalToolRetriever(), cache: new Map() })
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
    const embedFn = makeEmbedFromMap(new Map([['neg query', queryVec2]]))
    const embedMany = mock(
      makeEmbedManyFromMap(
        new Map([
          ['bad_tool. Bad tool. (misc)', badVec],
          ['less_bad. Less bad. (misc)', lessBadVec],
        ]),
      ),
    )
    const r = new EmbeddingToolRetriever({
      embed: embedFn,
      embedMany,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
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
    const embedFn = makeEmbedFromMap(new Map([['tie query', sharedVec]]))
    const embedMany = mock(
      makeEmbedManyFromMap(
        new Map([
          ['beta_tool. Beta tool. (misc)', sharedVec],
          ['alpha_tool. Alpha tool. (misc)', sharedVec],
        ]),
      ),
    )
    const r = new EmbeddingToolRetriever({
      embed: embedFn,
      embedMany,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
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
    const embedFn = makeEmbedFromMap(new Map([['limit test query', taskVec]]))
    const embedMany = mock(
      makeEmbedManyFromMap(
        new Map([
          [TASK_BRIEF_TEXT, taskVec],
          [WEB_BRIEF_TEXT, webVec],
          // orthogonal to query → similarity 0
          ['save_memo. Save memo. (memo)', [0, 1]],
        ]),
      ),
    )
    const r = new EmbeddingToolRetriever({
      embed: embedFn,
      embedMany,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
    const out = await r.rank('limit test query', threeBriefs, 2)
    expect(out.length).toBe(2)
  })

  it('caches brief embeddings across calls (batches each brief once)', async () => {
    const embed = mock(
      makeEmbedFromMap(
        new Map([
          ['tasks', taskVec],
          ['tasks again', webVec],
        ]),
      ),
    )
    const embedMany = mock(
      makeEmbedManyFromMap(
        new Map([
          [TASK_BRIEF_TEXT, taskVec],
          [WEB_BRIEF_TEXT, webVec],
        ]),
      ),
    )
    const cache = new Map<string, number[]>()
    const r = new EmbeddingToolRetriever({ embed, embedMany, lexical: new LexicalToolRetriever(), cache })
    await r.rank('tasks', briefs, 2)
    expect(embedMany.mock.calls.length).toBe(1)
    await r.rank('tasks again', briefs, 2)
    // second call embeds only the query; no new batch calls for cached briefs.
    expect(embedMany.mock.calls.length).toBe(1)
    expect(embed.mock.calls.length).toBe(2)
  })

  it('falls back to lexical when the query embedding is null', async () => {
    const embed = mock((_text: string): Promise<number[] | null> => Promise.resolve(null))
    const embedMany = mock(inertEmbedMany())
    const lexical = new LexicalToolRetriever()
    const r = new EmbeddingToolRetriever({ embed, embedMany, lexical, cache: new Map() })
    const out = await r.rank('list tasks', briefs, 2)
    expect(out[0]!.name).toBe('list_tasks')
    expect(embedMany).not.toHaveBeenCalled()
  })

  it('falls back to lexical ranking when the query embed throws', async () => {
    const embed = mock((_text: string): Promise<number[] | null> => Promise.reject(new Error('network down')))
    const embedMany = mock(inertEmbedMany())
    const r = new EmbeddingToolRetriever({ embed, embedMany, lexical: new LexicalToolRetriever(), cache: new Map() })
    const out = await r.rank('list tasks', briefs, 5)
    expect(out.length).toBeGreaterThan(0)
  })

  it('treats a failed brief batch as missing and falls back to lexical', async () => {
    // Query embeds fine; the brief batch rejects → chunk tombstoned, no scored briefs
    // → lexical fallback still returns results.
    const embed = mock(makeEmbedFromMap(new Map([['show my tasks', taskVec]])))
    const embedMany = mock((_texts: readonly string[]): Promise<number[][]> => Promise.reject(new Error('batch down')))
    const r = new EmbeddingToolRetriever({
      embed,
      embedMany,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
    const out = await r.rank('show my tasks', briefs, 5)
    expect(out.length).toBeGreaterThan(0)
  })

  it('falls back to lexical when the query embed throws on a warm cache', async () => {
    const cache = new Map<string, number[]>([
      ['list_tasks', taskVec],
      ['web_fetch', webVec],
    ])
    const embed = mock((_text: string): Promise<number[] | null> => Promise.reject(new Error('network down')))
    const r = new EmbeddingToolRetriever({
      embed,
      embedMany: mock(inertEmbedMany()),
      lexical: new LexicalToolRetriever(),
      cache,
    })

    const out = await r.rank('list tasks', briefs, 2)
    expect(out[0]!.name).toBe('list_tasks')
  })

  it('re-requests briefs whose vector the batch omitted', async () => {
    const embedManyCalls: string[][] = []
    const underlying = shortFirstBatchEmbedMany(taskVec)
    const embedMany = mock((texts: readonly string[]): Promise<number[][]> => {
      embedManyCalls.push([...texts])
      return underlying(texts)
    })
    const r = new EmbeddingToolRetriever({
      embed: mock((_text: string): Promise<number[] | null> => Promise.resolve(taskVec)),
      embedMany,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })

    await r.rank('first', briefs, 2)
    await r.rank('second', briefs, 2)

    // The omitted brief is not cached; the next rank re-requests exactly it
    expect(embedManyCalls.length).toBe(2)
    expect(embedManyCalls[1]).toEqual([WEB_BRIEF_TEXT])
  })

  it('scores only the briefs from succeeded chunks when another chunk fails', async () => {
    // 40 briefs → 2 chunks (32 + 8). The first chunk embeds, the second rejects
    // → its briefs are tombstoned and excluded from the scored set.
    const chunkedBriefs: ToolBrief[] = Array.from({ length: 40 }, (_, i) => ({
      name: `tool_${String(i).padStart(2, '0')}`,
      summary: `Tool number ${i}.`,
      domain: 'misc',
    }))
    const embed = mock((_text: string): Promise<number[] | null> => Promise.resolve(taskVec))
    const embedMany = mock(rejectTailChunks(taskVec, 8))
    const r = new EmbeddingToolRetriever({
      embed,
      embedMany,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
    const out = await r.rank('chunked query', chunkedBriefs, 40)
    // Only the 32 briefs of the succeeded chunk score; lexical fallback never kicks in
    // (scored set non-empty), so names come from embeddings alone.
    expect(out.length).toBe(32)
    expect(out.every((b) => b.name < 'tool_32')).toBe(true)
  })

  describe('dimension-mismatch guard', () => {
    it('excludes a cached brief whose vector length differs from the query vector, does not throw, and still ranks the matching brief', async () => {
      // query embeds have length 2; list_tasks cache entry has length 3 (stale/wrong model)
      const cache = new Map<string, number[]>()
      // dim 3 — mismatched vs query dim 2
      cache.set('list_tasks', [1, 0, 0])
      // dim 2 — matches the query vector below
      cache.set('web_fetch', [0, 1])

      // embed returns a dim-2 query vector aligning with web_fetch; briefs come from the cache
      const embedFn = makeEmbedFromMap(new Map([['fetch a page', [0, 1]]]))
      const r = new EmbeddingToolRetriever({
        embed: embedFn,
        embedMany: mock(inertEmbedMany()),
        lexical: new LexicalToolRetriever(),
        cache,
      })
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
      const r = new EmbeddingToolRetriever({ embed, embedMany: mock(inertEmbedMany()), lexical, cache })
      const out = await r.rank('list tasks', briefs, 2)
      // All briefs excluded → lexical fallback → list_tasks matches lexically
      expect(out[0]!.name).toBe('list_tasks')
    })
  })
})

const noneMetadata = {
  providerId: null,
  modelId: null,
  contextWindow: null,
  maxOutputTokens: null,
  source: 'none' as const,
  via: null,
}

const okConfig: LlmConfigResult = {
  ok: true,
  source: 'byok',
  main: {
    apiKey: 'byok-key',
    baseUrl: 'http://byok-llm',
    model: 'main-1',
    source: 'byok',
    metadata: noneMetadata,
  },
  small: {
    apiKey: 'byok-key',
    baseUrl: 'http://byok-llm',
    model: 'small-1',
    source: 'byok',
    metadata: noneMetadata,
  },
  embedding: {
    apiKey: 'byok-key',
    baseUrl: 'http://byok-llm',
    model: 'embed-1',
    source: 'byok',
    metadata: noneMetadata,
  },
}

const missingConfig: LlmConfigResult = {
  ok: false,
  type: 'missing',
  source: 'global',
  missing: ['llm_apikey'],
}

const callContext: EmbeddingCallContext = { storageContextId: 'ctx-1', contextType: 'dm', chatUserId: 'u1' }

describe('getToolRetriever', () => {
  beforeEach(() => {
    clearBriefEmbeddingCachesForTesting()
  })

  it('returns the lexical retriever when config resolution fails', () => {
    const deps: ToolRetrieverFactoryDeps = {
      resolveConfig: mock(() => missingConfig),
      embedText: mock(() => Promise.resolve(null)),
      embedTexts: mock(() => Promise.resolve([])),
    }
    const r = getToolRetriever('cfg-ctx', callContext, deps)
    expect(r).toBeInstanceOf(LexicalToolRetriever)
  })

  it('resolves per-context credentials and forwards the call context to embedText and embedTexts', async () => {
    const resolveConfig = mock((_id: string) => okConfig)
    const embedText: ToolRetrieverFactoryDeps['embedText'] = mock(
      (_text: string, _key: string, _url: string, _model: string, _ctx?: EmbeddingCallContext) =>
        Promise.resolve<number[] | null>(taskVec),
    )
    const embedTexts: ToolRetrieverFactoryDeps['embedTexts'] = mock(
      (_texts: readonly string[], _key: string, _url: string, _model: string, _ctx?: EmbeddingCallContext) =>
        Promise.resolve([[...taskVec], [...webVec]]),
    )
    const r = getToolRetriever('cfg-ctx', callContext, { resolveConfig, embedText, embedTexts })
    await r.rank('show my tasks', briefs, 2)
    expect(resolveConfig).toHaveBeenCalledWith('cfg-ctx')
    expect(embedText).toHaveBeenCalledWith('show my tasks', 'byok-key', 'http://byok-llm', 'embed-1', callContext)
    expect(embedTexts).toHaveBeenCalledWith(
      [TASK_BRIEF_TEXT, WEB_BRIEF_TEXT],
      'byok-key',
      'http://byok-llm',
      'embed-1',
      callContext,
    )
  })

  it('does not share brief caches across endpoints with the same model name', async () => {
    const otherEndpoint: LlmConfigResult = {
      ...okConfig,
      embedding: { ...okConfig.embedding, baseUrl: 'http://other-llm' },
    }
    let callsA = 0
    const embedTextA: ToolRetrieverFactoryDeps['embedText'] = () => {
      callsA++
      return Promise.resolve<number[] | null>(taskVec)
    }
    const embedTextsA: ToolRetrieverFactoryDeps['embedTexts'] = () => {
      callsA++
      return Promise.resolve([[...taskVec], [...taskVec]])
    }
    const rA = getToolRetriever('cfg-a', callContext, {
      resolveConfig: mock(() => okConfig),
      embedText: embedTextA,
      embedTexts: embedTextsA,
    })
    await rA.rank('show my tasks', briefs, 2)

    let callsB = 0
    const embedTextB: ToolRetrieverFactoryDeps['embedText'] = () => {
      callsB++
      return Promise.resolve<number[] | null>(webVec)
    }
    const embedTextsB: ToolRetrieverFactoryDeps['embedTexts'] = () => {
      callsB++
      return Promise.resolve([[...webVec], [...webVec]])
    }
    const rB = getToolRetriever('cfg-b', callContext, {
      resolveConfig: mock(() => otherEndpoint),
      embedText: embedTextB,
      embedTexts: embedTextsB,
    })
    await rB.rank('show my tasks', briefs, 2)
    // Each endpoint pays its own query embed and its own brief batch (1 + 1 = 2);
    // a shared cache would leave endpoint B at 1 (query only).
    expect(callsB).toBe(callsA)
  })

  it('reuses the warmed brief cache across retrievers of the same endpoint+model', async () => {
    const embedTextsCalls: string[][] = []
    const makeDeps = (): ToolRetrieverFactoryDeps => ({
      resolveConfig: mock(() => okConfig),
      embedText: mock((_t: string): Promise<number[] | null> => Promise.resolve(taskVec)),
      embedTexts: (texts: readonly string[]): Promise<number[][]> => {
        embedTextsCalls.push([...texts])
        return Promise.resolve(texts.map(() => taskVec))
      },
    })

    await getToolRetriever('cfg-shared', callContext, makeDeps()).rank('show my tasks', briefs, 2)
    expect(embedTextsCalls.length).toBe(1)

    // A second retriever for the same cacheKey finds the warmed cache — no new batch
    await getToolRetriever('cfg-shared', callContext, makeDeps()).rank('show my tasks again', briefs, 2)
    expect(embedTextsCalls.length).toBe(1)
  })

  it('joins one in-flight warm-up across retrievers of the same endpoint+model', async () => {
    const embedTextsCalls: string[][] = []
    const pendingReleases: Array<() => void> = []
    const makeDeps = (): ToolRetrieverFactoryDeps => ({
      resolveConfig: mock(() => okConfig),
      embedText: mock((_t: string): Promise<number[] | null> => Promise.resolve(taskVec)),
      embedTexts: (texts: readonly string[]): Promise<number[][]> => {
        embedTextsCalls.push([...texts])
        return new Promise((resolve) => {
          pendingReleases.push((): void => resolve(texts.map(() => taskVec)))
        })
      },
    })

    const rankA = getToolRetriever('cfg-join', callContext, makeDeps()).rank('query a', briefs, 2)
    await until(() => embedTextsCalls.length === 1)
    const rankB = getToolRetriever('cfg-join', callContext, makeDeps()).rank('query b', briefs, 2)
    await drainTicks(50)

    for (const release of pendingReleases) release()
    await Promise.all([rankA, rankB])

    expect(embedTextsCalls.length).toBe(1)
  })

  it('shares failure tombstones across retrievers of the same endpoint+model', async () => {
    const embedTexts = mock((_texts: readonly string[]): Promise<number[][]> => Promise.reject(new Error('throttled')))
    const makeDeps = (): ToolRetrieverFactoryDeps => ({
      resolveConfig: mock(() => okConfig),
      embedText: mock((_t: string): Promise<number[] | null> => Promise.resolve(taskVec)),
      embedTexts,
    })

    await getToolRetriever('cfg-ttl', callContext, makeDeps()).rank('first', briefs, 2)
    expect(embedTexts.mock.calls.length).toBe(1)

    // A different retriever for the same cacheKey sees the tombstone — no re-request
    await getToolRetriever('cfg-ttl', callContext, makeDeps()).rank('second', briefs, 2)
    expect(embedTexts.mock.calls.length).toBe(1)
  })

  it('resolves through the default deps and returns lexical when no config exists', async () => {
    mockLogger()
    await setupTestDb()
    const r = getToolRetriever('cfg-no-config', callContext)
    expect(r).toBeInstanceOf(LexicalToolRetriever)
  })
})
