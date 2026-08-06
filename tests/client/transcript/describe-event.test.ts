// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { describeEvent } from '../../../client/transcript/describe-event.js'
import type { DescribedEvent, PlanEntry } from '../../../client/transcript/describe-event.js'
import type { TranscriptEvent } from '../../../client/transcript/fetcher-schemas.js'

const ev = (type: TranscriptEvent['type'], payload: unknown): TranscriptEvent => ({
  seq: 1,
  ts: 't',
  type,
  payload,
})

const update = (payload: Record<string, unknown>): TranscriptEvent => ev('update', payload)

function toolTitle(described: DescribedEvent): string {
  if (described.kind !== 'tool') throw new Error('expected a tool event')
  return described.title
}

function planEntries(described: DescribedEvent): PlanEntry[] {
  if (described.kind !== 'plan') throw new Error('expected a plan event')
  return described.entries
}

describe('describeEvent — prompt', () => {
  test.each(['prompt', 'text', 'content'])('reads the body from payload.%s', (field) => {
    expect(describeEvent(ev('prompt', { [field]: 'ship it' }))).toEqual({ kind: 'prompt', body: 'ship it' })
  })

  test('prefers prompt over text over content', () => {
    const described = describeEvent(ev('prompt', { prompt: 'a', text: 'b', content: 'c' }))
    expect(described).toEqual({ kind: 'prompt', body: 'a' })
  })

  test('falls back to raw when the body is not a string', () => {
    expect(describeEvent(ev('prompt', { prompt: { nested: true } })).kind).toBe('raw')
  })

  test('falls back to raw when no known field is present', () => {
    expect(describeEvent(ev('prompt', { unexpected: 'x' })).kind).toBe('raw')
  })
})

describe('describeEvent — message and thought', () => {
  test('reads a message body from content', () => {
    expect(describeEvent(update({ sessionUpdate: 'agent_message_chunk', content: 'hi' }))).toEqual({
      kind: 'message',
      body: 'hi',
    })
  })

  test('reads a message body from text when content is absent', () => {
    expect(describeEvent(update({ sessionUpdate: 'agent_message_chunk', text: 'hi' }))).toEqual({
      kind: 'message',
      body: 'hi',
    })
  })

  test('reads a thought body', () => {
    expect(describeEvent(update({ sessionUpdate: 'agent_thought_chunk', content: 'hmm' }))).toEqual({
      kind: 'thought',
      body: 'hmm',
    })
  })

  test('falls back to raw when a message body is not a string', () => {
    expect(describeEvent(update({ sessionUpdate: 'agent_message_chunk', content: 42 })).kind).toBe('raw')
  })
})

describe('describeEvent — tool', () => {
  const tool = (status: unknown): TranscriptEvent => update({ sessionUpdate: 'tool_call', title: 'run tests', status })

  test.each([
    ['completed', 'accent', '✔'],
    ['failed', 'danger', '✖'],
    ['in_progress', 'info', '▸'],
    ['pending', 'warn', '·'],
  ] as const)('maps status %s to tone %s and glyph %s', (status, tone, glyph) => {
    expect(describeEvent(tool(status))).toEqual({ kind: 'tool', title: 'run tests', status, tone, glyph })
  })

  test('an unmapped status is neutral with the default glyph', () => {
    expect(describeEvent(tool('weird'))).toEqual({
      kind: 'tool',
      title: 'run tests',
      status: 'weird',
      tone: 'neutral',
      glyph: '·',
    })
  })

  test('a missing status yields an empty status string, not the text undefined', () => {
    const described = describeEvent(update({ sessionUpdate: 'tool_call', title: 'run tests' }))
    expect(described).toEqual({ kind: 'tool', title: 'run tests', status: '', tone: 'neutral', glyph: '·' })
  })

  test('falls back to toolCallId then the literal tool for the title', () => {
    expect(toolTitle(describeEvent(update({ sessionUpdate: 'tool_call', toolCallId: 'tc-1' })))).toBe('tc-1')
    expect(toolTitle(describeEvent(update({ sessionUpdate: 'tool_call' })))).toBe('tool')
  })

  test('tool_call_update takes the same branch as tool_call', () => {
    expect(describeEvent(update({ sessionUpdate: 'tool_call_update', title: 't', status: 'failed' })).kind).toBe('tool')
  })
})

describe('describeEvent — plan', () => {
  const plan = (entries: unknown): TranscriptEvent => update({ sessionUpdate: 'plan', entries })

  test('maps entries to content, status, and a checklist mark', () => {
    const described = describeEvent(
      plan([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ]),
    )
    expect(described).toEqual({
      kind: 'plan',
      entries: [
        { content: 'a', status: 'completed', mark: '[x]' },
        { content: 'b', status: 'in_progress', mark: '[~]' },
        { content: 'c', status: 'pending', mark: '[ ]' },
      ],
    })
  })

  test('defaults a missing entry status to pending', () => {
    expect(planEntries(describeEvent(plan([{ content: 'a' }])))).toEqual([
      { content: 'a', status: 'pending', mark: '[ ]' },
    ])
  })

  test.each([
    ['a non-array entries', 'not-an-array'],
    ['an empty entries array', []],
    ['an entry that is not an object', ['a']],
    ['an entry with no content', [{ status: 'pending' }]],
    ['an entry whose content is not a string', [{ content: 7 }]],
  ])('falls back to raw for %s', (_label, entries) => {
    expect(describeEvent(plan(entries)).kind).toBe('raw')
  })
})

describe('describeEvent — permission, result, raw', () => {
  test('permission_request is undecided', () => {
    expect(describeEvent(ev('permission_request', {}))).toEqual({ kind: 'permission', decided: false })
  })

  test('permission_decision is decided', () => {
    expect(describeEvent(ev('permission_decision', {}))).toEqual({ kind: 'permission', decided: true })
  })

  test('result carries the stop reason', () => {
    expect(describeEvent(ev('result', { stopReason: 'end_turn' }))).toEqual({
      kind: 'result',
      stopReason: 'end_turn',
    })
  })

  test('a missing stop reason is an empty string, not the text undefined', () => {
    expect(describeEvent(ev('result', {}))).toEqual({ kind: 'result', stopReason: '' })
  })

  test('an unknown sessionUpdate falls back to pretty-printed raw JSON', () => {
    const described = describeEvent(update({ sessionUpdate: 'available_commands_update', availableCommands: [] }))
    expect(described).toEqual({
      kind: 'raw',
      json: JSON.stringify({ sessionUpdate: 'available_commands_update', availableCommands: [] }, null, 2),
    })
  })

  test('a null payload renders as an empty object rather than throwing', () => {
    expect(describeEvent(ev('update', null))).toEqual({ kind: 'raw', json: '{}' })
  })
})

describe('describeEvent — non-object top-level payload', () => {
  test('a bare string payload on prompt serializes the original string, not {}', () => {
    expect(describeEvent(ev('prompt', 'hi'))).toEqual({ kind: 'raw', json: JSON.stringify('hi', null, 2) })
  })

  test('a bare string payload on update serializes the original string, not {}', () => {
    expect(describeEvent(ev('update', 'hi'))).toEqual({ kind: 'raw', json: JSON.stringify('hi', null, 2) })
  })

  test('a bare string payload on result ignores the payload shape entirely', () => {
    expect(describeEvent(ev('result', 'hi'))).toEqual({ kind: 'result', stopReason: '' })
  })

  test('a bare string payload on permission_request ignores the payload shape entirely', () => {
    expect(describeEvent(ev('permission_request', 'hi'))).toEqual({ kind: 'permission', decided: false })
  })

  test('a bare string payload on permission_decision ignores the payload shape entirely', () => {
    expect(describeEvent(ev('permission_decision', 'hi'))).toEqual({ kind: 'permission', decided: true })
  })
})
