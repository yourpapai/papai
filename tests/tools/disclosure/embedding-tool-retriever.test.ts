// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { EmbeddingCallContext } from '../../../src/embeddings.js'
import type { EffectiveLlmConfigResult } from '../../../src/llm-config-resolver.js'
import {
  clearBriefEmbeddingCachesForTesting,
  EmbeddingToolRetriever,
  getToolRetriever,
  type ToolRetrieverFactoryDeps,
} from '../../../src/tools/disclosure/embedding-tool-retriever.js'
import type { ToolBrief } from '../../../src/tools/disclosure/tool-brief.js'
import { LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'

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

// Returns an embed function backed by the given lookup map; unknown texts throw.
function makeEmbedThrowingForUnknown(vecByText: Map<string, number[]>): (text: string) => Promise<number[] | null> {
  return (text: string): Promise<number[] | null> =>
    vecByText.has(text) ? Promise.resolve(vecByText.get(text)!) : Promise.reject(new Error('boom'))
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

  it('falls back to lexical ranking when the query embed throws', async () => {
    const embed = mock((_text: string): Promise<number[] | null> => Promise.reject(new Error('network down')))
    const r = new EmbeddingToolRetriever({ embed, lexical: new LexicalToolRetriever(), cache: new Map() })
    const out = await r.rank('list tasks', briefs, 5)
    expect(out.length).toBeGreaterThan(0)
  })

  it('treats a throwing brief embed as missing and falls back to lexical', async () => {
    // Query embeds fine (in map); every brief embed throws (not in map) → no scored briefs
    // → lexical fallback still returns results.
    const queryOnlyMap = new Map<string, number[]>([['show my tasks', taskVec]])
    const r = new EmbeddingToolRetriever({
      embed: mock(makeEmbedThrowingForUnknown(queryOnlyMap)),
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
    const out = await r.rank('show my tasks', briefs, 5)
    expect(out.length).toBeGreaterThan(0)
  })

  it('scores only the briefs whose embeds succeed when others throw', async () => {
    // Query and list_tasks brief embed fine (in map); web_fetch brief is NOT in map
    // → its embed throws → web_fetch excluded from scored set → only list_tasks appears.
    const queryAndTaskMap = new Map<string, number[]>([
      ['show my tasks', taskVec],
      [TASK_BRIEF_TEXT, taskVec],
    ])
    const r = new EmbeddingToolRetriever({
      embed: mock(makeEmbedThrowingForUnknown(queryAndTaskMap)),
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
    const out = await r.rank('show my tasks', briefs, 5)
    expect(out.map((b) => b.name)).toEqual(['list_tasks'])
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

const okConfig: EffectiveLlmConfigResult = {
  ok: true,
  source: 'byok',
  llmApiKey: 'byok-key',
  llmBaseUrl: 'http://byok-llm',
  mainModel: 'main-1',
  smallModel: 'small-1',
  embeddingModel: 'embed-1',
}

const missingConfig: EffectiveLlmConfigResult = {
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
    }
    const r = getToolRetriever('cfg-ctx', callContext, deps)
    expect(r).toBeInstanceOf(LexicalToolRetriever)
  })

  it('resolves per-context credentials and forwards the call context to embedText', async () => {
    const resolveConfig = mock((_id: string) => okConfig)
    const embedText: ToolRetrieverFactoryDeps['embedText'] = mock(
      (_text: string, _key: string, _url: string, _model: string, _ctx?: EmbeddingCallContext) =>
        Promise.resolve<number[] | null>(taskVec),
    )
    const r = getToolRetriever('cfg-ctx', callContext, { resolveConfig, embedText })
    await r.rank('show my tasks', briefs, 2)
    expect(resolveConfig).toHaveBeenCalledWith('cfg-ctx')
    expect(embedText).toHaveBeenCalledWith('show my tasks', 'byok-key', 'http://byok-llm', 'embed-1', callContext)
  })

  it('does not share brief caches across endpoints with the same model name', async () => {
    const otherEndpoint: EffectiveLlmConfigResult = { ...okConfig, llmBaseUrl: 'http://other-llm' }
    let callsA = 0
    const embedA: ToolRetrieverFactoryDeps['embedText'] = (_t, _k, _u, _m, _c) => {
      callsA++
      return Promise.resolve<number[] | null>(taskVec)
    }
    const rA = getToolRetriever('cfg-a', callContext, { resolveConfig: mock(() => okConfig), embedText: embedA })
    await rA.rank('show my tasks', briefs, 2)

    let callsB = 0
    const embedB: ToolRetrieverFactoryDeps['embedText'] = (_t, _k, _u, _m, _c) => {
      callsB++
      return Promise.resolve<number[] | null>(webVec)
    }
    const rB = getToolRetriever('cfg-b', callContext, { resolveConfig: mock(() => otherEndpoint), embedText: embedB })
    await rB.rank('show my tasks', briefs, 2)
    // Endpoint B must embed the briefs itself (separate cache), not reuse endpoint A's vectors.
    expect(callsB).toBe(callsA)
  })
})
