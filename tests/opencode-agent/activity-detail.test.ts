// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { describeDetail, describeProviderDetail } from '../../opencode-agent/src/activity-detail.js'
import { describeActivity } from '../../opencode-agent/src/activity.js'

const SESSION = 'ses_02414f224ffejPyZrczmjjX3YF'
const OTHER = 'ses_somebody_else'

/**
 * The whitelist half of the event decoders. `activity.ts` decides what may be
 * said in public — names, statuses, counts — and says it to a world-readable
 * CI log. This module decodes the one argument per tool that a maintainer
 * debugging a run actually needs, and it exists only to feed the *encrypted*
 * transcript. The shapes are the same recorded ones `progress.test.ts` carries.
 */

const toolEvent = (tool: string, input: Record<string, unknown>, status = 'running'): unknown =>
  toolEventWithState(tool, { status, input })

/**
 * The same event with the tool part's `state` given whole, for the two cases
 * that need a field `toolEvent` does not model — a completed call's `output`.
 * Built as a literal rather than poked into a returned event, which needs a
 * type assertion `no-unsafe-type-assertion` refuses.
 */
const toolEventWithState = (tool: string, state: Record<string, unknown>): unknown => ({
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: { type: 'tool', tool, callID: 'call_1', state },
  },
})

/**
 * The decoded detail as a string, `''` when there is none.
 *
 * A module-level helper because `??` inside a test body trips
 * `vitest(no-conditional-in-test)`.
 */
const detailOf = (event: unknown): string => describeDetail(event, SESSION)?.detail ?? ''

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
    expect(detailOf(toolEvent('bash', { command: `x${'y'.repeat(500)}` }))).toHaveLength(200)
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
    const event = toolEventWithState('read', {
      status: 'completed',
      input: { filePath: 'package.json' },
      output: '<content>\n1: { "name": "papai" }',
    })

    expect(JSON.stringify(describeDetail(event, SESSION))).not.toContain('papai')
  })

  test('never carries a file’s new contents from an edit or a write', () => {
    const event = toolEvent(
      'write',
      { filePath: 'src/secret.ts', content: 'export const key = "hunter2"' },
      'completed',
    )

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

/**
 * The provider's own failure text, decoded for the **encrypted** transcript
 * only. The shapes are the pinned SDK's own: `session.status` retry carries
 * `status.message`, `session.error` carries `error.data.message` — re-verified
 * against `@opencode-ai/sdk@1.18.16` when this decoder was written, and both
 * fixtures below are the recorded ones `progress.test.ts` carries.
 *
 * This is the one widening the incident asked for: the provider's message was
 * dropped at decode, so no log, artifact or transcript anywhere named what the
 * gateway actually said while four runs burned 90 minutes each. The public log
 * keeps dropping it — a CI log is world-readable and a provider's error text is
 * the natural place for a rejected credential to be quoted back — and the
 * containment moves to the one place built to hold it.
 */
describe('describeProviderDetail', () => {
  const retryEvent = (status: Record<string, unknown>): unknown => ({
    type: 'session.status',
    properties: { sessionID: SESSION, status: { type: 'retry', ...status } },
  })

  const RETRY_WITH_MESSAGE = retryEvent({ attempt: 2, message: 'slow down', next: 1786102845761 })

  const ERROR_WITH_MESSAGE = {
    type: 'session.error',
    properties: {
      sessionID: SESSION,
      error: { name: 'APIError', data: { message: 'rate limit reached', statusCode: 429, isRetryable: true } },
    },
  } as const

  test('a retry decodes to a provider row carrying the provider’s own message', () => {
    expect(describeProviderDetail(RETRY_WITH_MESSAGE, SESSION)).toEqual({
      status: 'retry (attempt 2)',
      detail: 'slow down',
    })
  })

  test('a retry with no attempt number still names itself a retry', () => {
    expect(describeProviderDetail(retryEvent({ message: 'slow down' }), SESSION)).toEqual({
      status: 'retry',
      detail: 'slow down',
    })
  })

  test('a session error decodes to a provider row of its own', () => {
    expect(describeProviderDetail(ERROR_WITH_MESSAGE, SESSION)).toEqual({
      status: 'error',
      detail: 'rate limit reached',
    })
  })

  test('a session error the server could not attribute is still this run’s', () => {
    // `sessionID` is optional on `session.error` alone — one session per job —
    // which is the rule `activity.ts` already applies to the public decode.
    const unattributed = {
      type: 'session.error',
      properties: { error: { name: 'APIError', data: { message: 'quota exceeded' } } },
    } as const

    expect(describeProviderDetail(unattributed, SESSION)).toEqual({ status: 'error', detail: 'quota exceeded' })
  })

  test('an event about another session is not this run’s provider row', () => {
    expect(describeProviderDetail(RETRY_WITH_MESSAGE, OTHER)).toBeNull()
    expect(describeProviderDetail(ERROR_WITH_MESSAGE, OTHER)).toBeNull()
  })

  test('truncates a long provider message at the transcript’s own bound', () => {
    const long = retryEvent({ attempt: 1, message: `x${'y'.repeat(500)}` })

    expect(describeProviderDetail(long, SESSION)?.detail).toHaveLength(200)
  })

  test('a message that is not a string reads as no detail, never as content', () => {
    expect(describeProviderDetail(retryEvent({ attempt: 1, message: { nested: true } }), SESSION)).toEqual({
      status: 'retry (attempt 1)',
      detail: null,
    })
  })

  test('says nothing about a status that is not a retry, or any other event', () => {
    expect(describeProviderDetail(toolEvent('bash', { command: 'ls' }), SESSION)).toBeNull()
    expect(
      describeProviderDetail(
        { type: 'session.status', properties: { sessionID: SESSION, status: { type: 'busy' } } },
        SESSION,
      ),
    ).toBeNull()
    expect(describeProviderDetail({}, SESSION)).toBeNull()
    expect(describeProviderDetail(null, SESSION)).toBeNull()
  })

  test('the public decoder still drops the message, both events', () => {
    // The widening is transcript-side only: `activity.ts` keeps decoding names,
    // statuses and counts, so a credential a provider quotes back cannot reach
    // the world-readable CI log through this change.
    expect(JSON.stringify(describeActivity(RETRY_WITH_MESSAGE, SESSION))).not.toContain('slow down')
    expect(JSON.stringify(describeActivity(ERROR_WITH_MESSAGE, SESSION))).not.toContain('rate limit reached')
  })
})
