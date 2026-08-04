// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatToolStatus } from '../../src/live-status/tool-status-labels.js'

describe('formatToolStatus', () => {
  test('web_fetch shows the host without quotes', () => {
    expect(formatToolStatus('web_fetch', { url: 'https://example.com/path?q=1' })).toBe('🌐 Fetching example.com…')
  })

  test('falls back to the raw value when the url is unparseable', () => {
    expect(formatToolStatus('web_fetch', { url: 'not a url' })).toBe('🌐 Fetching not a url…')
  })

  test('search_memory quotes the query argument', () => {
    expect(formatToolStatus('search_memory', { query: 'budget' })).toBe('🔍 Searching memory: "budget"…')
  })

  test('create_task quotes the title argument', () => {
    expect(formatToolStatus('create_task', { title: 'Buy milk' })).toBe('📝 Creating task: "Buy milk"…')
  })

  test('mapped tool with no extractable argument omits the argument', () => {
    expect(formatToolStatus('create_task', {})).toBe('📝 Creating task…')
  })

  test('getStringField prefers the first listed key when both are present', () => {
    expect(formatToolStatus('create_task', { title: 'A', name: 'B' })).toBe('📝 Creating task: "A"…')
  })

  test('getStringField skips an empty first key and falls back to the next', () => {
    expect(formatToolStatus('create_task', { title: '', name: 'B' })).toBe('📝 Creating task: "B"…')
  })

  test('getStringField skips a non-string first key and falls back to the next', () => {
    expect(formatToolStatus('create_task', { title: 5, name: 'B' })).toBe('📝 Creating task: "B"…')
  })

  test('a whitespace-only argument is omitted like a missing argument', () => {
    expect(formatToolStatus('search_memory', { query: '   ' })).toBe('🔍 Searching memory…')
  })

  test('collapses whitespace and truncates long arguments to 40 chars', () => {
    const result = formatToolStatus('search_memory', { query: `  multi\nline   ${'a'.repeat(50)}` })
    expect(result).toBe(`🔍 Searching memory: "multi line ${'a'.repeat(29)}…"…`)
  })

  test('a 40-char argument is not truncated (boundary: length > MAX_ARG_LENGTH is false at 40)', () => {
    expect(formatToolStatus('search_memory', { query: 'a'.repeat(40) })).toBe(
      `🔍 Searching memory: "${'a'.repeat(40)}"…`,
    )
  })

  test('a 41-char argument truncates to 40 chars plus ellipsis (boundary)', () => {
    expect(formatToolStatus('search_memory', { query: 'a'.repeat(41) })).toBe(
      `🔍 Searching memory: "${'a'.repeat(40)}…"…`,
    )
  })

  test('plugin tool falls back to humanized last segment', () => {
    expect(formatToolStatus('plugin_audio-transcribe__transcribe', { audioId: 'x' })).toBe('⚙️ Running transcribe…')
  })

  test('mcp tool falls back to humanized last segment', () => {
    expect(formatToolStatus('mcp_server__do_thing', {})).toBe('⚙️ Running do thing…')
  })

  test('unmapped core tool falls back to humanized full name', () => {
    expect(formatToolStatus('add_watcher', {})).toBe('⚙️ Running add watcher…')
  })

  test('never returns the argument when input is not a record', () => {
    expect(formatToolStatus('search_memory', 'budget')).toBe('🔍 Searching memory…')
  })
})

describe('reminder/alert live-status labels', () => {
  test('create_reminder renders a friendly reminder label', () => {
    expect(formatToolStatus('create_reminder', { prompt: 'Check the gigachat model' })).toBe(
      '⏰ Setting up a reminder: "Check the gigachat model"…',
    )
  })

  test('create_alert renders a friendly alert label', () => {
    expect(formatToolStatus('create_alert', { prompt: 'Ping me when done' })).toBe(
      '🔔 Setting up an alert: "Ping me when done"…',
    )
  })

  test('cancel_reminder renders a friendly label and never mentions "deferred"', () => {
    const out = formatToolStatus('cancel_reminder', { id: 'abc' })
    expect(out).not.toContain('deferred')
    expect(out).toContain('Cancelling')
  })
})
