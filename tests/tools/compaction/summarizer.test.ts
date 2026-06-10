// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock } from 'bun:test'
import type { Mock } from 'bun:test'

import { summarizeResult, type SummarizerDeps } from '../../../src/tools/compaction/summarizer.js'

type GenerateOpts = { model: unknown; system: string; prompt: string }
type GenerateFn = (opts: GenerateOpts) => Promise<{ text: string }>

function depsReturning(text: string): { deps: SummarizerDeps; generateMock: Mock<GenerateFn> } {
  const generateMock: Mock<GenerateFn> = mock(
    (opts: GenerateOpts): Promise<{ text: string }> =>
      Promise.resolve({ text, _system: opts.system } as { text: string }),
  )
  return { deps: { model: 'stub-model', generate: generateMock }, generateMock }
}

function depsThrowing(): SummarizerDeps {
  return {
    model: 'stub-model',
    generate: mock((_opts: GenerateOpts): Promise<{ text: string }> => Promise.reject(new Error('model down'))),
  }
}

describe('summarizeResult', () => {
  it('returns a model summary and passes tool name + intent into the prompt', async () => {
    const { deps, generateMock } = depsReturning('Three overdue tasks in Auth.')
    const out = await summarizeResult(
      { serialized: '{"rows":[...]}', totalBytes: 40000, toolName: 'list_tasks', userIntent: 'overdue in Auth' },
      deps,
    )
    expect(out.summary).toBe('Three overdue tasks in Auth.')
    const firstCall = generateMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const callOpts = firstCall?.[0]
    expect(callOpts?.prompt).toContain('list_tasks')
    expect(callOpts?.prompt).toContain('overdue in Auth')
  })

  it('returns summary:null when the model throws', async () => {
    const out = await summarizeResult(
      { serialized: 'x', totalBytes: 9, toolName: 't', userIntent: 'i' },
      depsThrowing(),
    )
    expect(out.summary).toBeNull()
  })

  it('returns summary:null when the model returns empty text', async () => {
    const { deps } = depsReturning('   ')
    const out = await summarizeResult({ serialized: 'x', totalBytes: 9, toolName: 't', userIntent: 'i' }, deps)
    expect(out.summary).toBeNull()
  })
})
