// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ToolBrief } from '../../../src/tools/disclosure/tool-brief.js'
import { LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'
import type { RankedBrief, ToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'

const briefs: ToolBrief[] = [
  { name: 'list_tasks', summary: 'List tasks in a project.', domain: 'task' },
  { name: 'web_fetch', summary: 'Fetch a public web page.', domain: 'web' },
  { name: 'save_memo', summary: 'Save a personal note.', domain: 'memo' },
]

describe('tool-retriever module exports', () => {
  it('exports LexicalToolRetriever that implements ToolRetriever', () => {
    const r: ToolRetriever = new LexicalToolRetriever()
    expect(typeof r.rank).toBe('function')
    expect(r.rank('x', [], 1)).toBeInstanceOf(Promise)
  })

  it('RankedBrief includes score on top of ToolBrief shape', async () => {
    const r = new LexicalToolRetriever()
    const results: RankedBrief[] = await r.rank(
      'tasks',
      [{ name: 'list_tasks', summary: 'List tasks.', domain: 'task' }],
      1,
    )
    expect(results[0]?.score).toBeGreaterThan(0)
  })
})

describe('LexicalToolRetriever (mutation targets)', () => {
  const r = new LexicalToolRetriever()

  it('returns [] for empty query (whitespace only)', async () => {
    expect(await r.rank('   ', briefs, 5)).toEqual([])
  })

  it('returns [] when query has only single-char tokens', async () => {
    // Token 'a' has length 1 and is filtered; qTokens becomes empty → [].
    expect(await r.rank('a', briefs, 5)).toEqual([])
  })

  it('multi-separator run produces only valid tokens (no empty or single-char)', async () => {
    // 'a--list!!tasks' → tokens ['list','tasks']; single-char 'a' excluded.
    const out = await r.rank('a--list!!tasks', briefs, 3)
    expect(out[0]!.name).toBe('list_tasks')
  })

  it('a_tool with single-char-only summary scores 0 when query has no single-char tokens', async () => {
    // 'a a a' only generates the token 'a' (length 1, filtered); hTokens = {}.
    // With query 'a--list!!tasks' → qTokens = {list, tasks}; a_tool overlap = 0 → score = 0.
    // maxScore > 0 (list_tasks matches), so zero-score fillers are included up to limit=5.
    // a_tool is guaranteed in the output; its score must be exactly 0.
    const singleCharBriefs: ToolBrief[] = [{ name: 'a_tool', summary: 'a a a', domain: 'a' }, ...briefs]
    const out2 = await r.rank('a--list!!tasks', singleCharBriefs, 5)
    const aToolResult = out2.find((b) => b.name === 'a_tool')
    expect(aToolResult).toBeDefined()
    expect(aToolResult!.score).toBe(0)
  })

  it('is case-insensitive: uppercase query matches lowercase brief', async () => {
    const out = await r.rank('LIST TASKS', briefs, 3)
    expect(out[0]!.name).toBe('list_tasks')
  })

  it('is case-insensitive: uppercase brief summary matches lowercase query', async () => {
    const upperBriefs: ToolBrief[] = [
      { name: 'list_tasks', summary: 'LIST TASKS IN A PROJECT', domain: 'TASK' },
      { name: 'web_fetch', summary: 'Fetch a public web page.', domain: 'web' },
    ]
    const out = await r.rank('list tasks', upperBriefs, 2)
    expect(out[0]!.name).toBe('list_tasks')
  })

  it('substring bonus: NOT awarded when query length <= 2', async () => {
    // 'we' has length 2; even though 'web_fetch' haystack contains 'we' the bonus is NOT given.
    // 'we' as a 2-char token IS in qTokens but no hToken equals 'we' → overlap 0 → score 0 → [].
    expect(await r.rank('we', briefs, 5)).toEqual([])
  })

  it('substring bonus: awarded when query length > 2 and verbatim in haystack', async () => {
    // Query 'list tasks': tokens {list,tasks}; haystack of list_tasks contains 'list tasks' verbatim.
    // overlap=2 + substringBonus=1 → score=3.
    const out = await r.rank('list tasks', briefs, 5)
    expect(out[0]!.name).toBe('list_tasks')
    expect(out[0]!.score).toBe(3)
  })

  it('exact score: overlap-only match with no substring bonus', async () => {
    // 'web fetch': tokens {web,fetch}; 'web_fetch' haystack has both → overlap=2.
    // The haystack does NOT contain 'web fetch' as substring (underscore between) → bonus=0 → score=2.
    const out = await r.rank('web fetch', briefs, 5)
    expect(out[0]!.name).toBe('web_fetch')
    expect(out[0]!.score).toBe(2)
  })

  it('all zero scores returns [] even with a valid query', async () => {
    // maxScore = 0 → early return [].
    const unrelated: ToolBrief[] = [
      { name: 'alpha_tool', summary: 'Completely unrelated.', domain: 'other' },
      { name: 'beta_tool', summary: 'Nothing matching here.', domain: 'other' },
    ]
    expect(await r.rank('zxqvjw', unrelated, 5)).toEqual([])
  })

  it('sort order: higher score first; equal scores name-ascending tie-break', async () => {
    // Both score 1; tie-break by name asc → alpha_tool before beta_tool.
    const tieBreakBriefs: ToolBrief[] = [
      { name: 'beta_tool', summary: 'Save a note.', domain: 'misc' },
      { name: 'alpha_tool', summary: 'Write a memo.', domain: 'misc' },
      { name: 'list_tasks', summary: 'List tasks.', domain: 'task' },
    ]
    // 'note memo' → qTokens={note,memo}; beta_tool overlap=1(note); alpha_tool overlap=1(memo); list_tasks overlap=0.
    const out = await r.rank('note memo', tieBreakBriefs, 5)
    expect(out[0]!.name).toBe('alpha_tool')
    expect(out[1]!.name).toBe('beta_tool')
  })

  it('limit/slice: returns exactly limit items (top by score)', async () => {
    const manyBriefs: ToolBrief[] = [
      { name: 'list_tasks', summary: 'List tasks in a project.', domain: 'task' },
      { name: 'task_search', summary: 'Search tasks.', domain: 'task' },
      { name: 'task_count', summary: 'Count tasks.', domain: 'task' },
      { name: 'web_fetch', summary: 'Fetch a public web page.', domain: 'web' },
    ]
    // 'tasks' matches list_tasks, task_search, task_count (all score > 0); web_fetch scores 0.
    const out = await r.rank('tasks', manyBriefs, 2)
    expect(out.length).toBe(2)
    expect(out.every((b) => b.score > 0)).toBe(true)
  })

  it('returns [] for no-match empty briefs array', async () => {
    // maxScore reduce over empty array = 0 → [].
    expect(await r.rank('anything', [], 5)).toEqual([])
  })

  it('overlap uses distinct hTokens (Set), not raw token count', async () => {
    // 'tasks tasks tasks' summary: hTokens = {'tasks'} (Set), overlap with qTokens {'tasks'} = 1.
    // Even though 'tasks' appears 3 times in the haystack, it only counts once.
    const dupBriefs: ToolBrief[] = [{ name: 'dup_tool', summary: 'tasks tasks tasks', domain: 'misc' }]
    const out = await r.rank('tasks', dupBriefs, 1)
    // overlap=1 + substringBonus=1 ('tasks' len>2, verbatim in haystack)
    expect(out[0]!.score).toBe(2)
  })
})
