// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { describeDetail } from '../../opencode-agent/src/activity-detail.js'

const SESSION = 'ses_02414f224ffejPyZrczmjjX3YF'
const OTHER = 'ses_somebody_else'

/**
 * The whitelist half of the event decoders. `activity.ts` decides what may be
 * said in public — names, statuses, counts — and says it to a world-readable
 * CI log. This module decodes the one argument per tool that a maintainer
 * debugging a run actually needs, and it exists only to feed the *encrypted*
 * transcript. The shapes are the same recorded ones `progress.test.ts` carries.
 */

const toolEvent = (tool: string, input: Record<string, unknown>, status = 'running'): unknown => ({
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: { type: 'tool', tool, callID: 'call_1', state: { status, input } },
  },
})

describe('describeDetail', () => {
  test('carries a bash command, which is what a failing run is usually about', () => {
    expect(describeDetail(toolEvent('bash', { command: 'bun test tests/retry.test.ts' }), SESSION)).toEqual({
      tool: 'bash',
      callID: 'call_1',
      detail: 'bun test tests/retry.test.ts',
    })
  })

  test('truncates a bash command at 200 characters', () => {
    // A command can be a heredoc carrying a whole file; the transcript is a
    // debugging aid, not a second copy of the working tree.
    const detail = describeDetail(toolEvent('bash', { command: `x${'y'.repeat(500)}` }), SESSION)?.detail ?? ''

    expect(detail).toHaveLength(200)
  })

  test.each([['read'], ['edit'], ['write']])('carries the file path for %s', (tool) => {
    expect(describeDetail(toolEvent(tool, { filePath: 'src/retry.ts' }), SESSION)?.detail).toBe('src/retry.ts')
  })

  test.each([['grep'], ['glob']])('carries the pattern for %s', (tool) => {
    expect(describeDetail(toolEvent(tool, { pattern: 'retryOperation' }), SESSION)?.detail).toBe('retryOperation')
  })

  test('carries no detail for a tool off the whitelist', () => {
    // The row still records that the tool ran — the whitelist is about the
    // argument, not about the call.
    expect(describeDetail(toolEvent('todowrite', { todos: ['a'] }), SESSION)).toEqual({
      tool: 'todowrite',
      callID: 'call_1',
      detail: null,
    })
  })

  test('never carries the tool output, which is an entire file', () => {
    const event = toolEvent('read', { filePath: 'package.json' }, 'completed') as {
      properties: { part: { state: Record<string, unknown> } }
    }
    event.properties.part.state['output'] = '<content>\n1: { "name": "papai" }'

    expect(JSON.stringify(describeDetail(event, SESSION))).not.toContain('papai')
  })

  test('never carries a file’s new contents from an edit or a write', () => {
    const event = toolEvent('write', { filePath: 'src/secret.ts', content: 'export const key = "hunter2"' }, 'completed')

    expect(JSON.stringify(describeDetail(event, SESSION))).not.toContain('hunter2')
  })

  test('says nothing about the model’s own text', () => {
    const text = {
      type: 'message.part.updated',
      properties: { sessionID: SESSION, part: { type: 'text', text: 'here is the answer' } },
    }

    expect(describeDetail(text, SESSION)).toBeNull()
  })

  test('says nothing about an event for another session', () => {
    expect(describeDetail(toolEvent('bash', { command: 'ls' }), OTHER)).toBeNull()
  })

  test.each([
    [{ type: 'plugin.added', properties: { id: 'core/config-reference' } }],
    [{ type: 'message.part.updated', properties: { sessionID: SESSION, part: { type: 'tool' } } }],
    [{}],
    ['not an event'],
    [null],
  ])('says nothing about %p rather than failing on it', (event) => {
    expect(describeDetail(event, SESSION)).toBeNull()
  })

  test('a non-string whitelisted field reads as no detail, never as content', () => {
    // The field table names scalars; a moved shape carrying an object under
    // `command` must not be stringified into the transcript.
    expect(describeDetail(toolEvent('bash', { command: { nested: true } }), SESSION)?.detail).toBeNull()
  })
})
