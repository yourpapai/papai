// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock } from 'bun:test'

import { EmbeddingToolRetriever } from '../../../src/tools/disclosure/embedding-tool-retriever.js'
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
})
