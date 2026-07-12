// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createScenarioEvents } from './events.js'

describe('scenario events', () => {
  test('assigns increasing sequence numbers and the current phase', () => {
    const events = createScenarioEvents('create task')

    events.record('chat.message', { text: 'create a task' })
    events.setPhase('assertions')
    events.record('chat.reply', { text: 'created' })

    expect(events.all()).toEqual([
      { seq: 1, phase: 'setup', kind: 'chat.message', data: { text: 'create a task' } },
      { seq: 2, phase: 'assertions', kind: 'chat.reply', data: { text: 'created' } },
    ])
    expect(events.recent(1)).toEqual([{ seq: 2, phase: 'assertions', kind: 'chat.reply', data: { text: 'created' } }])
  })

  test('recursively redacts sensitive metadata while preserving useful values', () => {
    const events = createScenarioEvents('redaction')

    events.record('http.request', {
      headers: {
        Authorization: 'Bearer real-token',
        'x-api-key': 'api-secret',
        accept: 'application/json',
      },
      nested: [{ refreshToken: 'refresh-secret', projectId: 'project-1' }],
      client_secret: 'client-secret',
    })

    expect(events.all()[0]?.data).toEqual({
      headers: {
        Authorization: '[REDACTED]',
        'x-api-key': '[REDACTED]',
        accept: 'application/json',
      },
      nested: [{ refreshToken: '[REDACTED]', projectId: 'project-1' }],
      client_secret: '[REDACTED]',
    })
  })

  test('returns snapshots that cannot mutate recorded events', () => {
    const events = createScenarioEvents('snapshots')
    const source = { nested: { value: 'original' } }
    events.record('custom', source)

    source.nested.value = 'changed'
    const [recorded] = events.all()
    Reflect.set(Object(recorded), 'phase', 'leaked')

    expect(events.all()[0]).toEqual({
      seq: 1,
      phase: 'setup',
      kind: 'custom',
      data: { nested: { value: 'original' } },
    })
  })

  test('formats deterministic failures with scenario, phase, recent events, and no secrets', () => {
    const events = createScenarioEvents('failed story')
    events.setPhase('when message')
    events.record('http.request', { authorization: 'Bearer hidden', url: 'https://example.test/tasks' })

    const formatted = events.formatFailure('unexpected request')

    expect(formatted).toContain('scenario: failed story')
    expect(formatted).toContain('phase: when message')
    expect(formatted).toContain('unexpected request')
    expect(formatted).toContain('[REDACTED]')
    expect(formatted).not.toContain('Bearer hidden')
    expect(formatted).toBe(events.formatFailure('unexpected request'))
  })
})
