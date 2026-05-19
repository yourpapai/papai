// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach, mock } from 'bun:test'
import assert from 'node:assert/strict'

import { setCachedConfig } from '../../src/cache.js'
import { makeGetCurrentTimeTool } from '../../src/tools/get-current-time.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

interface TimeResult {
  datetime: string
  timezone: string
  formatted: string
}

function isTimeResult(val: unknown): val is TimeResult {
  return (
    val !== null &&
    typeof val === 'object' &&
    'datetime' in val &&
    typeof (val as Record<string, unknown>)['datetime'] === 'string' &&
    'timezone' in val &&
    typeof (val as Record<string, unknown>)['timezone'] === 'string' &&
    'formatted' in val &&
    typeof (val as Record<string, unknown>)['formatted'] === 'string'
  )
}

describe('makeGetCurrentTimeTool', () => {
  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
    setCachedConfig('user-1', 'timezone', 'Asia/Karachi')
  })

  test('returns tool with correct structure', () => {
    const tool = makeGetCurrentTimeTool()
    expect(tool.description).toContain('current local date and time')
  })

  test('returns current time in user timezone', async () => {
    const tool = makeGetCurrentTimeTool('user-1')
    assert(tool.execute, 'Tool execute is undefined')

    const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })

    assert(isTimeResult(result), 'Invalid result')
    expect(result).toHaveProperty('datetime')
    expect(result).toHaveProperty('timezone')
  })

  test('returns UTC when no timezone configured', async () => {
    const tool = makeGetCurrentTimeTool('user-2')
    assert(tool.execute, 'Tool execute is undefined')

    const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })

    assert(isTimeResult(result), 'Invalid result')
    expect(result.timezone).toBe('UTC')
  })

  test('normalizes legacy UTC offset config before returning timezone', async () => {
    setCachedConfig('user-legacy', 'timezone', 'UTC+5')
    const tool = makeGetCurrentTimeTool('user-legacy')
    assert(tool.execute, 'Tool execute is undefined')

    const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })

    assert(isTimeResult(result), 'Invalid result')
    expect(result.timezone).toBe('Etc/GMT-5')
  })

  test('returns local datetime (not UTC) when timezone is configured', async () => {
    const tool = makeGetCurrentTimeTool('user-1')
    assert(tool.execute, 'Tool execute is undefined')

    const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })

    assert(isTimeResult(result), 'Invalid result')
    // Local time should NOT have a trailing Z (UTC indicator)
    expect(result.datetime.endsWith('Z')).toBe(false)
  })

  test('legacy UTC offset returns local datetime, not UTC', async () => {
    setCachedConfig('user-legacy', 'timezone', 'UTC+5')
    const tool = makeGetCurrentTimeTool('user-legacy')
    assert(tool.execute, 'Tool execute is undefined')

    const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })

    assert(isTimeResult(result), 'Invalid result')
    // Normalized to Etc/GMT-5, so Intl.DateTimeFormat works and returns local time
    expect(result.datetime.endsWith('Z')).toBe(false)
  })

  test('returns ISO string datetime shape', async () => {
    const tool = makeGetCurrentTimeTool('user-1')
    assert(tool.execute, 'Tool execute is undefined')

    const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })

    assert(isTimeResult(result), 'Invalid result')
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u
    expect(result.datetime).toMatch(isoPattern)
  })

  test('includes formatted local date string', async () => {
    const tool = makeGetCurrentTimeTool('user-1')
    assert(tool.execute, 'Tool execute is undefined')

    const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })

    assert(isTimeResult(result), 'Invalid result')
    expect(result).toHaveProperty('formatted')
  })
})
