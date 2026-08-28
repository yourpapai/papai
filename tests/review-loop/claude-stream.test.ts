// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { createClaudeStreamDecoder } from '../../review-loop/src/claude-stream.js'
import type { OpencodeEvent } from '../../review-loop/src/event-stream.js'

// The recorded corpus, read at test time by relative path — a file read, not a
// runtime import; the subprocess boundary between the workspaces holds.
const FIXTURE_DIR = path.join(import.meta.dir, '..', 'opencode-agent', 'fixtures', 'claude-cli')

function fixtureLines(name: string): string[] {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
}

function toolUseEvents(events: readonly OpencodeEvent[]): Extract<OpencodeEvent, { type: 'tool_use' }>[] {
  return events.filter((evt): evt is Extract<OpencodeEvent, { type: 'tool_use' }> => evt.type === 'tool_use')
}

/** The first event as a step_start, or a loud mismatch — so test bodies carry no type conditionals. */
function stepStartOf(events: readonly OpencodeEvent[]): Extract<OpencodeEvent, { type: 'step_start' }> {
  const first = events[0]
  if (first === undefined || first.type !== 'step_start') throw new Error('expected a step_start event')
  return first
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Whether a fixture carries a result line, and whether it signals an error. */
function corpusResult(name: string): { seen: boolean; isError: boolean } {
  let seen = false
  let isError = false
  for (const line of fixtureLines(name)) {
    const parsed: unknown = JSON.parse(line)
    if (isRecord(parsed) && parsed['type'] === 'result') {
      seen = true
      isError = parsed['is_error'] === true
    }
  }
  return { seen, isError }
}

describe('claude-stream decoder over the recorded corpus', () => {
  test('system/init maps to one step_start and is the session-id source', () => {
    const decoder = createClaudeStreamDecoder()
    const init = fixtureLines('success-turn.ndjson')[0]!

    const events = decoder.parseLine(init)

    expect(events).toHaveLength(1)
    expect(typeof stepStartOf(events).timestamp).toBe('number')
    expect(decoder.sessionIdOf(init)).toBe('0d9f2a55-7b3a-4c1e-9f0a-2f7c8d11ab02')
  })

  test('assistant tool_use blocks map to running tool_use with input passthrough; text blocks are dropped', () => {
    const decoder = createClaudeStreamDecoder()
    const lines = fixtureLines('success-turn.ndjson')
    // one content array carrying [text, tool_use]
    const assistant = lines[2]!

    const events = decoder.parseLine(assistant)

    const toolUses = toolUseEvents(events)
    expect(toolUses).toHaveLength(1)
    expect(toolUses[0]).toEqual({
      type: 'tool_use',
      tool: 'Read',
      callId: 'toolu_01A2B3C4',
      status: 'running',
      input: { file_path: 'README.md' },
    })
    // The same line's text block is deliberately dropped: nothing consumes the
    // union's text member, and the corpus mixes both block kinds in one array.
    expect(events.filter((evt) => evt.type === 'text')).toHaveLength(0)
  })

  test('user tool_result blocks pair by tool_use_id, carrying tool and input from the assistant block', () => {
    const decoder = createClaudeStreamDecoder()
    const lines = fixtureLines('success-turn.ndjson')
    // assistant tool_use
    decoder.parseLine(lines[2]!)
    // its tool_result
    const user = lines[3]!

    const events = toolUseEvents(decoder.parseLine(user))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'tool_use',
      tool: 'Read',
      callId: 'toolu_01A2B3C4',
      status: 'completed',
      input: { file_path: 'README.md' },
    })
  })

  test('a text-only assistant line yields no events', () => {
    const decoder = createClaudeStreamDecoder()
    const lines = fixtureLines('success-turn.ndjson')
    expect(decoder.parseLine(lines[4]!)).toEqual([])
  })

  test('stream_event lines are unrecognized: empty list, role proceeds', () => {
    const decoder = createClaudeStreamDecoder()
    const streamEvent = fixtureLines('success-turn.ndjson')[1]!
    expect(decoder.parseLine(streamEvent)).toEqual([])
  })

  test('result maps to one synthetic step_finish with the full token/cost tuple', () => {
    const decoder = createClaudeStreamDecoder()
    const result = fixtureLines('success-turn.ndjson')[5]!

    const events = decoder.parseLine(result)

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'step_finish',
      reason: 'end_turn',
      tokens: { input: 1052, output: 60, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0.0123,
    })
  })

  test('the auth-error corpus result line reports an error outcome', () => {
    const decoder = createClaudeStreamDecoder()
    for (const line of fixtureLines('auth-error-turn.ndjson')) {
      decoder.parseLine(line)
    }
    expect(decoder.resultOutcome()).toEqual({ seen: true, isError: true })
  })

  test('a fresh decoder has seen no result', () => {
    const decoder = createClaudeStreamDecoder()
    expect(decoder.resultOutcome()).toEqual({ seen: false, isError: false })
  })

  test('every corpus file decodes without failing, and each result line agrees with resultOutcome', () => {
    const files = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.ndjson'))
    expect(files.length).toBeGreaterThan(0)
    const withResultLine = files.filter((name) => corpusResult(name).seen)
    expect(withResultLine.length).toBeGreaterThan(0)
    for (const name of withResultLine) {
      const decoder = createClaudeStreamDecoder()
      for (const line of fixtureLines(name)) {
        decoder.parseLine(line)
      }
      expect(decoder.resultOutcome()).toEqual({ seen: true, isError: corpusResult(name).isError })
    }
  })

  test('a non-JSON line yields an empty list', () => {
    const decoder = createClaudeStreamDecoder()
    expect(decoder.parseLine('not json at all')).toEqual([])
  })
})

describe('claude-stream synthetic multi-block leg', () => {
  // The recorded corpus carries at most one tool_use per assistant line and
  // one tool_result per user line (census-verified), so the per-block mapping
  // is pinned here instead: parallel tool calls in one message.

  const twoToolUses = JSON.stringify({
    type: 'assistant',
    message: {
      id: 'msg_multi',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Opening both files.' },
        { type: 'tool_use', id: 'toolu_AAA', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'tool_use', id: 'toolu_BBB', name: 'Grep', input: { pattern: 'todo' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 10 },
    },
    session_id: 'sess-multi',
  })

  const twoToolResults = JSON.stringify({
    type: 'user',
    message: {
      id: 'msg_multi_result',
      type: 'message',
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_AAA', content: 'boom', is_error: true },
        { type: 'tool_result', tool_use_id: 'toolu_BBB', content: 'found 2', is_error: false },
      ],
    },
    session_id: 'sess-multi',
  })

  test('one assistant line carrying two tool_use blocks yields both calls', () => {
    const decoder = createClaudeStreamDecoder()
    const events = toolUseEvents(decoder.parseLine(twoToolUses))

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      type: 'tool_use',
      tool: 'Read',
      callId: 'toolu_AAA',
      status: 'running',
      input: { file_path: 'a.ts' },
    })
    expect(events[1]).toEqual({
      type: 'tool_use',
      tool: 'Grep',
      callId: 'toolu_BBB',
      status: 'running',
      input: { pattern: 'todo' },
    })
  })

  test('one user line carrying two tool_result blocks pairs both, with the true tool of each', () => {
    const decoder = createClaudeStreamDecoder()
    decoder.parseLine(twoToolUses)

    const events = toolUseEvents(decoder.parseLine(twoToolResults))

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      type: 'tool_use',
      tool: 'Read',
      callId: 'toolu_AAA',
      status: 'error',
      input: { file_path: 'a.ts' },
    })
    expect(events[1]).toEqual({
      type: 'tool_use',
      tool: 'Grep',
      callId: 'toolu_BBB',
      status: 'completed',
      input: { pattern: 'todo' },
    })
  })

  test('assistant-line usage is ignored: only the result line counts usage', () => {
    const decoder = createClaudeStreamDecoder()
    const before = decoder.parseLine(twoToolUses)
    expect(before.filter((evt) => evt.type === 'step_finish')).toHaveLength(0)

    const result = decoder.parseLine(
      JSON.stringify({
        type: 'result',
        is_error: false,
        stop_reason: 'end_turn',
        session_id: 'sess-multi',
        total_cost_usd: 0.5,
        usage: {
          output_tokens_details: { thinking_tokens: 7 },
          input_tokens: 11,
          cache_creation_input_tokens: 13,
          cache_read_input_tokens: 17,
          output_tokens: 19,
        },
      }),
    )
    expect(result).toEqual([
      {
        type: 'step_finish',
        reason: 'end_turn',
        tokens: { input: 11, output: 19, reasoning: 7, cacheRead: 17, cacheWrite: 13 },
        cost: 0.5,
      },
    ])
  })

  test('a tool_result with no paired assistant block is skipped', () => {
    const decoder = createClaudeStreamDecoder()
    const orphan = JSON.stringify({
      type: 'user',
      message: {
        id: 'msg_orphan',
        type: 'message',
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_UNKNOWN', content: 'late', is_error: false }],
      },
      session_id: 'sess-multi',
    })
    expect(decoder.parseLine(orphan)).toEqual([])
  })
})
