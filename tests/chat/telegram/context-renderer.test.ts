import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { renderTelegramContext } from '../../../src/chat/telegram/context-renderer.js'
import { standardContextSnapshot } from '../fixtures/context-snapshot.js'

describe('renderTelegramContext', () => {
  test('returns a text method result', () => {
    const result = renderTelegramContext(standardContextSnapshot)
    expect(result.method).toBe('text')
  })

  test('contains header with model and usage', () => {
    const result = renderTelegramContext(standardContextSnapshot)
    assert(result.method === 'text')
    expect(result.content).toContain('gpt-4o')
    expect(result.content).toContain('6,770')
    expect(result.content).toContain('128,000')
    expect(result.content).toMatch(/5\.\d%/)
  })

  test('contains the emoji grid', () => {
    const result = renderTelegramContext(standardContextSnapshot)
    assert(result.method === 'text')
    expect(result.content).toContain('🟦')
    expect(result.content).toContain('⬜')
  })

  test('wraps detail section in a code block', () => {
    const result = renderTelegramContext(standardContextSnapshot)
    assert(result.method === 'text')
    expect(result.content).toContain('```')
    expect(result.content).toContain('System prompt')
    expect(result.content).toContain('820')
    expect(result.content).toContain('Conversation history')
    expect(result.content).toContain('34 messages')
  })

  test('omits percentage when maxTokens is null', () => {
    const result = renderTelegramContext({ ...standardContextSnapshot, maxTokens: null })
    assert(result.method === 'text')
    expect(result.content).not.toMatch(/%/)
    expect(result.content).toContain('6,770 tokens')
  })

  test('notes approximate counts when applicable', () => {
    const result = renderTelegramContext({ ...standardContextSnapshot, approximate: true })
    assert(result.method === 'text')
    expect(result.content).toMatch(/approximate/i)
  })
})
