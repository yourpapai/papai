// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatLlmOutput } from '../../plugins/chat-provider-telegram/format.js'

describe('formatLlmOutput', () => {
  describe('inline formatting', () => {
    test('bold', () => {
      const result = formatLlmOutput('**bold**')
      expect(result.text).toBe('bold')
      expect(result.entities).toEqual([{ offset: 0, length: 4, type: 'bold' }])
    })

    test('italic', () => {
      const result = formatLlmOutput('*italic*')
      expect(result.text).toBe('italic')
      expect(result.entities).toEqual([{ offset: 0, length: 6, type: 'italic' }])
    })

    test('strikethrough', () => {
      const result = formatLlmOutput('~~strike~~')
      expect(result.text).toBe('strike')
      expect(result.entities).toEqual([{ offset: 0, length: 6, type: 'strikethrough' }])
    })

    test('inline code', () => {
      const result = formatLlmOutput('`code`')
      expect(result.text).toBe('code')
      expect(result.entities).toEqual([{ offset: 0, length: 4, type: 'code' }])
    })

    test('bold and italic in the same message', () => {
      const result = formatLlmOutput('**bold** and *italic*')
      expect(result.text).toBe('bold and italic')
      expect(result.entities).toEqual([
        { offset: 0, length: 4, type: 'bold' },
        { offset: 9, length: 6, type: 'italic' },
      ])
    })

    test('unclosed bold passes through as plain text', () => {
      const result = formatLlmOutput('**unclosed')
      expect(result.text).toBe('**unclosed')
      expect(result.entities).toEqual([])
    })

    test('nested bold italic', () => {
      const result = formatLlmOutput('***bold italic***')
      expect(result.text).toBe('bold italic')
      const types = result.entities.map((e) => e.type)
      expect(types).toContain('bold')
      expect(types).toContain('italic')
    })
  })

  describe('block formatting', () => {
    test('h1 header becomes bold', () => {
      const result = formatLlmOutput('# Title')
      expect(result.text).toBe('Title')
      expect(result.entities).toEqual([{ offset: 0, length: 5, type: 'bold' }])
    })

    test('h2 header becomes bold', () => {
      const result = formatLlmOutput('## Subtitle')
      expect(result.text).toBe('Subtitle')
      expect(result.entities).toEqual([{ offset: 0, length: 8, type: 'bold' }])
    })

    test('fenced code block with language', () => {
      const result = formatLlmOutput('```typescript\nconsole.log("hi")\n```')
      expect(result.text).toBe('console.log("hi")')
      expect(result.entities).toEqual([{ offset: 0, length: 17, type: 'pre', language: 'typescript' }])
    })

    test('fenced code block without language', () => {
      const result = formatLlmOutput('```\nconsole.log("hi")\n```')
      expect(result.text).toBe('console.log("hi")')
      expect(result.entities).toHaveLength(1)
      const entity = result.entities[0]!
      expect(entity.type).toBe('pre')
      expect(entity.offset).toBe(0)
      expect(entity.length).toBe(17)
    })

    test('h3 header becomes bold', () => {
      const result = formatLlmOutput('### Section')
      expect(result.text).toBe('Section')
      expect(result.entities).toEqual([{ offset: 0, length: 7, type: 'bold' }])
    })

    test('h4 header becomes bold', () => {
      const result = formatLlmOutput('#### Subsection')
      expect(result.text).toBe('Subsection')
      expect(result.entities).toEqual([{ offset: 0, length: 10, type: 'bold' }])
    })

    test('blockquote', () => {
      const result = formatLlmOutput('> quoted text')
      expect(result.text).toBe('quoted text')
      expect(result.entities).toEqual([{ offset: 0, length: 11, type: 'blockquote' }])
    })
  })

  describe('links', () => {
    test('standalone markdown link', () => {
      const result = formatLlmOutput('[text](http://example.com)')
      expect(result.text).toBe('text')
      expect(result.entities).toEqual([{ offset: 0, length: 4, type: 'text_link', url: 'http://example.com' }])
    })

    test('inline link within a sentence', () => {
      const result = formatLlmOutput('See [ABC-123](https://linear.app/issue/ABC-123) for details')
      expect(result.text).toBe('See ABC-123 for details')
      expect(result.entities).toEqual([
        { offset: 4, length: 7, type: 'text_link', url: 'https://linear.app/issue/ABC-123' },
      ])
    })

    test('multiple links in one message', () => {
      const result = formatLlmOutput('See [issue 1](https://linear.app/1) and [issue 2](https://linear.app/2)')
      expect(result.text).toBe('See issue 1 and issue 2')
      expect(result.entities).toEqual([
        { offset: 4, length: 7, type: 'text_link', url: 'https://linear.app/1' },
        { offset: 16, length: 7, type: 'text_link', url: 'https://linear.app/2' },
      ])
    })

    test('bare URL becomes a text_link entity', () => {
      const result = formatLlmOutput('See https://linear.app/issue/ABC-123')
      expect(result.text).toBe('See https://linear.app/issue/ABC-123')
      expect(result.entities).toEqual([
        { offset: 4, length: 32, type: 'text_link', url: 'https://linear.app/issue/ABC-123' },
      ])
    })
  })

  describe('tables', () => {
    test('links in table cells become text_link entities without raw markdown in text', () => {
      const result = formatLlmOutput(
        '| Issue | Link |\n|-------|------|\n| ABC-123 | [ABC-123](https://linear.app/issue/ABC-123) |',
      )
      expect(result.text).toBe('Issue | Link\nABC-123 | ABC-123')
      expect(result.text).not.toContain('](')
      expect(result.entities).toEqual([
        { offset: 23, length: 7, type: 'text_link', url: 'https://linear.app/issue/ABC-123' },
      ])
    })

    test('bold and links in table cells both produce entities', () => {
      const result = formatLlmOutput(
        '| Name | Status |\n|------|--------|\n| **urgent** | [ABC-123](https://linear.app/1) |',
      )
      expect(result.text).toBe('Name | Status\nurgent | ABC-123')
      expect(result.entities).toEqual([
        { offset: 14, length: 6, type: 'bold' },
        { offset: 23, length: 7, type: 'text_link', url: 'https://linear.app/1' },
      ])
    })

    test('table surrounded by paragraphs preserves paragraph separation', () => {
      const result = formatLlmOutput(
        'Before.\n\n| Issue | Link |\n|-------|------|\n| ABC-123 | [ABC-123](https://linear.app/1) |\n\nAfter.',
      )
      expect(result.text).toBe('Before.\n\nIssue | Link\nABC-123 | ABC-123\n\nAfter.')
      expect(result.entities).toEqual([{ offset: 32, length: 7, type: 'text_link', url: 'https://linear.app/1' }])
    })

    test('multiple tables each produce correct entities with accurate offsets', () => {
      const result = formatLlmOutput(
        '| A | B |\n|---|---|\n| [x](https://a.com) | y |\n\nBetween.\n\n| C | D |\n|---|---|\n| z | [w](https://b.com) |',
      )
      expect(result.text).toBe('A | B\nx | y\n\nBetween.\n\nC | D\nz | w')
      expect(result.entities).toEqual([
        { offset: 6, length: 1, type: 'text_link', url: 'https://a.com' },
        { offset: 33, length: 1, type: 'text_link', url: 'https://b.com' },
      ])
    })
  })

  describe('lists', () => {
    test('single newline before list items gets converted to double newline', () => {
      const result = formatLlmOutput('Your projects:\n- Project 1\n- Project 2')
      expect(result.text).toBe('Your projects:\n\n- Project 1\n- Project 2')
      expect(result.entities).toEqual([])
    })

    test('double newline before list items is preserved', () => {
      const result = formatLlmOutput('Your projects:\n\n- Project 1\n- Project 2')
      expect(result.text).toBe('Your projects:\n\n- Project 1\n- Project 2')
      expect(result.entities).toEqual([])
    })

    test('numbered lists are also handled', () => {
      const result = formatLlmOutput('Steps:\n1. First\n2. Second')
      expect(result.text).toBe('Steps:\n\n1. First\n2. Second')
      expect(result.entities).toEqual([])
    })
  })

  describe('edge cases', () => {
    test('plain text produces no entities', () => {
      const result = formatLlmOutput('just plain text')
      expect(result.text).toBe('just plain text')
      expect(result.entities).toEqual([])
    })

    test('empty string', () => {
      const result = formatLlmOutput('')
      expect(result.text).toBe('')
      expect(result.entities).toEqual([])
    })

    test('CRLF line endings treated same as LF', () => {
      const result = formatLlmOutput('**bold**\r\ntext')
      expect(result.text).not.toContain('\r')
      const types = result.entities.map((e) => e.type)
      expect(types).toContain('bold')
    })
  })
})
