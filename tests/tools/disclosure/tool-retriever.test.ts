// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'
import type { ToolRetriever, RankedBrief } from '../../../src/tools/disclosure/tool-retriever.js'

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
