// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { chunkForTelegram } from '../../../src/chat/telegram/chunking.js'
import { telegramTraits } from '../../../src/chat/telegram/metadata.js'

const defaultTelegramLimit = telegramTraits.maxMessageLength ?? 0

describe('chunkForTelegram', () => {
  test('returns a single chunk for input within the limit', () => {
    expect(chunkForTelegram('short text', 2000)).toEqual(['short text'])
  })

  test('returns single-element array for empty input', () => {
    expect(chunkForTelegram('', 2000)).toEqual([''])
  })

  test('handles exactly-max-length input without splitting', () => {
    const input = 'y'.repeat(4096)
    expect(chunkForTelegram(input)).toEqual([input])
  })

  test('default limit is the telegram maxMessageLength trait', () => {
    const input = 'x'.repeat(5000)
    expect(defaultTelegramLimit).toBe(4096)
    expect(chunkForTelegram(input)).toEqual(chunkForTelegram(input, defaultTelegramLimit))
    expect(chunkForTelegram(input, defaultTelegramLimit)).toHaveLength(2)
  })

  test('splits on paragraph boundary preferentially', () => {
    const first = 'a'.repeat(3000)
    const second = 'b'.repeat(3000)
    const input = `${first}\n\n${second}`
    const chunks = chunkForTelegram(input)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.endsWith('\n\n')).toBe(true)
    expect(chunks[1]!).toBe(second)
    expect(chunks.join('')).toBe(input)
  })

  test('splits on single newline when no paragraph break exists', () => {
    const first = 'a'.repeat(3000)
    const second = 'b'.repeat(3000)
    const input = `${first}\n${second}`
    const chunks = chunkForTelegram(input)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.endsWith('\n')).toBe(true)
    expect(chunks[1]!).toBe(second)
    expect(chunks.join('')).toBe(input)
  })

  test('falls back to a hard cut when no boundary sits within the limit', () => {
    const first = 'a'.repeat(5000)
    const second = 'b'.repeat(100)
    const input = `${first}\n\n${second}`
    const chunks = chunkForTelegram(input)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.length).toBe(4096)
    expect(chunks.join('')).toBe(input)
  })

  test('hard-cuts an oversize single line and terminates', () => {
    const input = 'x'.repeat(10000)
    const chunks = chunkForTelegram(input)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096)
    }
    expect(chunks.join('')).toBe(input)
  })

  test('terminates on an oversize single line with a small custom maxLen', () => {
    const input = 'y'.repeat(35)
    const chunks = chunkForTelegram(input, 10)
    expect(chunks).toEqual(['yyyyyyyyyy', 'yyyyyyyyyy', 'yyyyyyyyyy', 'yyyyy'])
    expect(chunks.join('')).toBe(input)
  })

  test('keeps every chunk within the limit when a boundary sits at the cut', () => {
    const paragraphCase = `${'a'.repeat(4095)}\n\n${'b'.repeat(50)}`
    for (const chunk of chunkForTelegram(paragraphCase)) {
      expect(chunk.length).toBeLessThanOrEqual(4096)
    }
    expect(chunkForTelegram(paragraphCase).join('')).toBe(paragraphCase)

    const newlineCase = `${'c'.repeat(4095)}\n${'d'.repeat(50)}`
    for (const chunk of chunkForTelegram(newlineCase)) {
      expect(chunk.length).toBeLessThanOrEqual(4096)
    }
    expect(chunkForTelegram(newlineCase).join('')).toBe(newlineCase)
  })

  test('honors a custom maxLen below the default', () => {
    const input = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}\n\n${'c'.repeat(60)}`
    const chunks = chunkForTelegram(input, 100)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100)
    }
    expect(chunks.join('')).toBe(input)
  })

  test('joined chunks preserve text and order across mixed content', () => {
    const input = ['Intro paragraph.', '', 'x'.repeat(4500), '', 'Closing line after a long block.'].join('\n')
    const chunks = chunkForTelegram(input)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(input)
  })

  test('clamps a non-positive maxLen so the splitter always advances', () => {
    const input = 'z'.repeat(10)
    for (const limit of [0, -5]) {
      const chunks = chunkForTelegram(input, limit)
      expect(chunks).toHaveLength(10)
      for (const chunk of chunks) {
        expect(chunk).toBe('z')
      }
      expect(chunks.join('')).toBe(input)
    }
    expect(chunkForTelegram('tiny', 0)).toEqual(['t', 'i', 'n', 'y'])
  })
})
