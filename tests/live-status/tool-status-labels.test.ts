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

  test('collapses whitespace and truncates long arguments to 40 chars', () => {
    const long = 'a'.repeat(50)
    const result = formatToolStatus('search_memory', { query: `  multi\nline   ${long}` })
    expect(result.startsWith('🔍 Searching memory: "multi line ')).toBe(true)
    expect(result.endsWith('…"…')).toBe(true)
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
