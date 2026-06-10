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
})
