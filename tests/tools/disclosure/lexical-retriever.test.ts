// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ToolBrief } from '../../../src/tools/disclosure/tool-brief.js'
import { LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'

const briefs: ToolBrief[] = [
  { name: 'list_tasks', summary: 'List tasks in a project.', domain: 'task' },
  { name: 'web_fetch', summary: 'Fetch a public web page.', domain: 'web' },
  { name: 'save_memo', summary: 'Save a personal note.', domain: 'memo' },
]

describe('LexicalToolRetriever', () => {
  const r = new LexicalToolRetriever()

  it('ranks the most relevant brief first', async () => {
    const out = await r.rank('list my tasks', briefs, 2)
    expect(out[0]!.name).toBe('list_tasks')
    expect(out.length).toBe(2)
    expect(out[1]!.score).toBe(0)
  })

  it('returns empty for an empty query', async () => {
    expect(await r.rank('   ', briefs, 5)).toEqual([])
  })

  it('returns no matches as empty when nothing overlaps', async () => {
    expect(await r.rank('zzzzz', briefs, 5)).toEqual([])
  })

  it('single-char tokens from multi-separator runs do not contribute to score', async () => {
    // 'a--list!!tasks' tokenizes to ['list', 'tasks'] — single-char 'a' is excluded by length > 1 filter.
    // Query 'a' produces zero tokens (only token 'a' has length 1, filtered out) → returns [].
    const singleCharBriefs: ToolBrief[] = [{ name: 'a_tool', summary: 'a a a', domain: 'a' }, ...briefs]
    expect(await r.rank('a', singleCharBriefs, 5)).toEqual([])
  })

  it('a_tool with single-char-only summary scores 0 when mixed-token query is used', async () => {
    // 'a a a' only generates the token 'a' (length 1, filtered); hTokens = {}.
    // With query 'a--list!!tasks' → qTokens = {list, tasks}; a_tool overlap = 0 → score = 0.
    // maxScore > 0 (list_tasks matches), so zero-score fillers are included up to limit=5.
    // a_tool is guaranteed in the output (4 briefs, limit 5); assert its score is exactly 0.
    const singleCharBriefs: ToolBrief[] = [{ name: 'a_tool', summary: 'a a a', domain: 'a' }, ...briefs]
    const out = await r.rank('a--list!!tasks', singleCharBriefs, 5)
    expect(out[0]!.name).toBe('list_tasks')
    const aToolResult = out.find((b) => b.name === 'a_tool')
    expect(aToolResult).toBeDefined()
    expect(aToolResult!.score).toBe(0)
  })

  it('is case-insensitive: uppercase query matches lowercase brief name', async () => {
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

  it('substring bonus is NOT awarded for queries of length <= 2', async () => {
    // 'we' has length 2 so substringBonus = 0 even though 'web_fetch' haystack contains 'we'.
    // The token 'we' (length 2 > 1) IS a valid query token.
    // 'web_fetch' hTokens include 'web','fetch','public','page' — none equals 'we' → overlap = 0 → score = 0.
    expect(await r.rank('we', briefs, 5)).toEqual([])
  })

  it('substring bonus IS awarded for queries of length > 2 that appear verbatim in the haystack', async () => {
    // Query 'list tasks': length 10 > 2; haystack of list_tasks contains 'list tasks' verbatim.
    // list_tasks hTokens = {list, tasks, in, project, task} ∩ qTokens {list, tasks} = 2; bonus = 1; score = 3.
    // web_fetch overlap = 0, score = 0.
    // save_memo overlap = 0, score = 0.
    const out = await r.rank('list tasks', briefs, 5)
    expect(out[0]!.name).toBe('list_tasks')
    expect(out[0]!.score).toBe(3)
  })

  it('returns exact scores: overlap-only match scores exactly the distinct-token overlap count', async () => {
    // Query 'web fetch': qTokens = {web, fetch}.
    // web_fetch hTokens = {web, fetch, public, page} → overlap = 2; qText='web fetch' len=9 > 2,
    // haystack = 'web_fetch fetch a public web page. web' — does it include 'web fetch'?
    // "web_fetch fetch..." does NOT include "web fetch" as a substring (underscore present before fetch).
    // bonus = 0; score = 2.
    const out = await r.rank('web fetch', briefs, 5)
    expect(out[0]!.name).toBe('web_fetch')
    expect(out[0]!.score).toBe(2)
  })

  it('sort order: higher score comes first; equal scores use name-ascending tie-break', async () => {
    // 'alpha_tool' and 'beta_tool' both overlap 'note memo' by 1 token each (note / memo).
    const tieBreakBriefs: ToolBrief[] = [
      { name: 'beta_tool', summary: 'Save a note.', domain: 'misc' },
      { name: 'alpha_tool', summary: 'Write a memo.', domain: 'misc' },
      { name: 'list_tasks', summary: 'List tasks.', domain: 'task' },
    ]
    // 'note memo' → qTokens = {note, memo}
    // list_tasks: hTokens = {list, tasks} → overlap = 0
    // beta_tool: hTokens = {beta, tool, save, note} → overlap = 1 (note)
    // alpha_tool: hTokens = {alpha, tool, write, memo} → overlap = 1 (memo)
    // Both score 1; tie-break by name asc → alpha_tool before beta_tool.
    const out = await r.rank('note memo', tieBreakBriefs, 5)
    expect(out[0]!.name).toBe('alpha_tool')
    expect(out[1]!.name).toBe('beta_tool')
  })

  it('limit/slice: returns exactly limit items, taking the top ones by score', async () => {
    const manyBriefs: ToolBrief[] = [
      { name: 'list_tasks', summary: 'List tasks in a project.', domain: 'task' },
      { name: 'task_search', summary: 'Search tasks.', domain: 'task' },
      { name: 'task_count', summary: 'Count tasks.', domain: 'task' },
      { name: 'web_fetch', summary: 'Fetch a public web page.', domain: 'web' },
    ]
    // Query 'tasks': qTokens = {tasks}
    // list_tasks: hTokens includes 'tasks' → overlap 1
    // task_search: hTokens = {task, search, tasks} → overlap 1 (tasks)
    // task_count: hTokens = {task, count, tasks} → overlap 1 (tasks)
    // web_fetch: hTokens = {web, fetch, public, page} → overlap 0
    // All matching: maxScore > 0 → fill to limit; limit=2 → 2 results.
    const out = await r.rank('tasks', manyBriefs, 2)
    expect(out.length).toBe(2)
    // All three task briefs score ≥ 1; web_fetch scores 0 and should not be in top 2.
    expect(out.every((b) => b.score > 0)).toBe(true)
  })

  it('all-zero scores with a non-empty query returns []', async () => {
    // maxScore = 0 guard: even with a valid query, if no brief overlaps → return [].
    const unrelatedBriefs: ToolBrief[] = [
      { name: 'alpha_tool', summary: 'Completely unrelated.', domain: 'other' },
      { name: 'beta_tool', summary: 'Nothing matching here.', domain: 'other' },
    ]
    expect(await r.rank('zxqvjw', unrelatedBriefs, 5)).toEqual([])
  })
})
