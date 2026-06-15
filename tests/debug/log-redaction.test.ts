// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LogEntry } from '../../src/debug/log-buffer.js'
import { redactLogEntry } from '../../src/debug/log-redaction.js'

const base: LogEntry = {
  level: 30,
  time: '2026-06-15T00:00:00.000Z',
  msg: 'Message received from user',
}

describe('redactLogEntry', () => {
  test('keeps allowlisted fields, drops everything else', () => {
    const entry: LogEntry = {
      ...base,
      scope: 'orchestrator',
      turnId: 't_9',
      messageLength: 8,
      userText: 'buy milk',
      chatUserId: '123',
      contextId: 'u:123',
    }
    expect(redactLogEntry(entry)).toEqual({
      level: 30,
      time: '2026-06-15T00:00:00.000Z',
      msg: 'Message received from user',
      scope: 'orchestrator',
      turnId: 't_9',
      messageLength: 8,
    })
  })

  test('redacts msg not in the safe-template set', () => {
    expect(redactLogEntry({ ...base, msg: 'fetched https://x.com/abc' }).msg).toBe('[redacted]')
  })

  test('keeps a safe-template msg verbatim', () => {
    expect(redactLogEntry({ ...base, msg: 'Tool execution failed' }).msg).toBe('Tool execution failed')
  })

  test('drops free-text error but keeps errorType/errorCode', () => {
    const out = redactLogEntry({
      ...base,
      error: 'TASK-9 buy milk failed',
      errorType: 'provider',
      errorCode: 'NOT_FOUND',
    })
    expect(out).not.toHaveProperty('error')
    expect(out['errorType']).toBe('provider')
    expect(out['errorCode']).toBe('NOT_FOUND')
  })
})
