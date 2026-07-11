// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  dedupeDocuments,
  formatDocuments,
  formatFailures,
  parseContextCodes,
  parseSources,
} from '../../plugins/mcp-rag/format.js'

describe('mcp-rag format', () => {
  test('parseContextCodes trims, splits on semicolon, and drops empties', () => {
    expect(parseContextCodes('a; b ;;c')).toEqual(['a', 'b', 'c'])
    expect(parseContextCodes('')).toEqual([])
  })

  test('parseSources trims, splits on comma, and drops empties', () => {
    expect(parseSources('x, y ,,z')).toEqual(['x', 'y', 'z'])
    expect(parseSources(undefined)).toEqual([])
    expect(parseSources('')).toEqual([])
  })

  test('dedupeDocuments keeps first-wins by document_id/url and never collapses keyless docs', () => {
    const result = dedupeDocuments([
      { document_id: '1', title: 'A' },
      { document_id: '1', title: 'A2' },
      { url: 'u', title: 'B' },
      { title: 'C' },
      { title: 'D' },
    ])
    expect(result).toHaveLength(4)
    const kept = result.find((doc) => doc.document_id === '1')
    expect(kept?.title).toBe('A')
    expect(result.some((doc) => doc.title === 'C')).toBe(true)
    expect(result.some((doc) => doc.title === 'D')).toBe(true)
  })

  test('formatDocuments returns fallback message for empty list', () => {
    expect(formatDocuments([])).toBe('No documents found.')
  })

  test('formatDocuments includes title, url, and source line when present', () => {
    const output = formatDocuments([{ title: 'T', url: 'http://x', source: 'youtrack', source_type: 'issue' }])
    expect(output).toContain('Found 1 documents:')
    expect(output).toContain('1. T')
    expect(output).toContain('http://x')
    expect(output).toContain('source: youtrack/issue')
  })

  test('formatDocuments omits source line when absent and falls back for missing title/url', () => {
    const output = formatDocuments([{ title: 'T2', url: 'http://y' }, { url: 'http://z' }, { document_id: 'D9' }])
    expect(output).not.toContain('source:')
    expect(output).toContain('(untitled)')
    expect(output).toContain('D9')
  })

  test('formatFailures returns empty string for no failures', () => {
    expect(formatFailures([])).toBe('')
  })

  test('formatFailures joins context code and error for each failure', () => {
    const output = formatFailures([
      { contextCode: 'c1', error: 'boom' },
      { contextCode: 'c2', error: 'nope' },
    ])
    expect(output).toContain('c1')
    expect(output).toContain('boom')
    expect(output).toContain('c2')
    expect(output).toContain('nope')
  })
})
