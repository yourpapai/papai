// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ResolvedStreamTextResult } from '../../src/llm-orchestrator-events.js'
import { extractSearchMemoryPulls } from '../../src/long-term-memory/shadow-pull-extract.js'

type Steps = ResolvedStreamTextResult['steps']

function stepWithNoToolCalls(): Steps[number] {
  return { toolCalls: [], toolResults: [] }
}

function searchMemoryStep(toolCallId: string, query: unknown, recordIds: readonly string[]): Steps[number] {
  return {
    toolCalls: [{ toolName: 'search_memory', toolCallId, input: { query } }],
    toolResults: [{ toolCallId, output: { records: recordIds.map((id) => ({ id })) } }],
  }
}

function otherToolStep(): Steps[number] {
  return {
    toolCalls: [{ toolName: 'remember_memory', toolCallId: 'call-other', input: { content: 'x' } }],
    toolResults: [{ toolCallId: 'call-other', output: { id: 'record-x' } }],
  }
}

describe('extractSearchMemoryPulls', () => {
  test('no search_memory call yields an empty, unpulled result', () => {
    const result = extractSearchMemoryPulls([stepWithNoToolCalls(), otherToolStep()])

    expect(result).toEqual({ pulled: false, pullCount: 0, queries: [], resultIds: [] })
  })

  test('one search_memory call extracts its query and result ids', () => {
    const steps = [searchMemoryStep('call-1', 'pricing rollout decision', ['record-a', 'record-b'])]

    const result = extractSearchMemoryPulls(steps)

    expect(result).toEqual({
      pulled: true,
      pullCount: 1,
      queries: ['pricing rollout decision'],
      resultIds: ['record-a', 'record-b'],
    })
  })

  test('two search_memory calls merge queries and result ids in order', () => {
    const steps = [
      searchMemoryStep('call-1', 'first query', ['record-a']),
      otherToolStep(),
      searchMemoryStep('call-2', 'second query', ['record-b', 'record-c']),
    ]

    const result = extractSearchMemoryPulls(steps)

    expect(result).toEqual({
      pulled: true,
      pullCount: 2,
      queries: ['first query', 'second query'],
      resultIds: ['record-a', 'record-b', 'record-c'],
    })
  })

  test('malformed tool output does not throw and yields empty ids', () => {
    const steps: Steps = [
      {
        toolCalls: [{ toolName: 'search_memory', toolCallId: 'call-1', input: { query: 'hello' } }],
        toolResults: [{ toolCallId: 'call-1', output: 'not-an-object' }],
      },
    ]

    const result = extractSearchMemoryPulls(steps)

    expect(result).toEqual({ pulled: true, pullCount: 1, queries: ['hello'], resultIds: [] })
  })

  test('missing toolResults entry for a call yields empty ids for that call', () => {
    const steps: Steps = [
      {
        toolCalls: [{ toolName: 'search_memory', toolCallId: 'call-1', input: { query: 'hello' } }],
        toolResults: [],
      },
    ]

    const result = extractSearchMemoryPulls(steps)

    expect(result).toEqual({ pulled: true, pullCount: 1, queries: ['hello'], resultIds: [] })
  })

  test('non-string query input does not throw and is omitted from queries', () => {
    const steps: Steps = [
      {
        toolCalls: [{ toolName: 'search_memory', toolCallId: 'call-1', input: { query: 42 } }],
        toolResults: [{ toolCallId: 'call-1', output: { records: [{ id: 'record-a' }] } }],
      },
    ]

    const result = extractSearchMemoryPulls(steps)

    expect(result).toEqual({ pulled: true, pullCount: 1, queries: [], resultIds: ['record-a'] })
  })

  test('records with non-string ids are dropped defensively', () => {
    const steps: Steps = [
      {
        toolCalls: [{ toolName: 'search_memory', toolCallId: 'call-1', input: { query: 'hello' } }],
        toolResults: [{ toolCallId: 'call-1', output: { records: [{ id: 'record-a' }, { id: 7 }, { notId: 'x' }] } }],
      },
    ]

    const result = extractSearchMemoryPulls(steps)

    expect(result).toEqual({ pulled: true, pullCount: 1, queries: ['hello'], resultIds: ['record-a'] })
  })

  test('empty steps array yields empty, unpulled result', () => {
    const result = extractSearchMemoryPulls([])

    expect(result).toEqual({ pulled: false, pullCount: 0, queries: [], resultIds: [] })
  })
})
