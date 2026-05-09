import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { renderDiscordContext } from '../../../src/chat/discord/context-renderer.js'
import type { ContextRendered } from '../../../src/chat/types.js'
import { standardContextSnapshot } from '../fixtures/context-snapshot.js'

function assertEmbed(result: ContextRendered): asserts result is Extract<ContextRendered, { method: 'embed' }> {
  assert(result.method === 'embed', 'expected embed method')
}

describe('renderDiscordContext', () => {
  test('returns embed method with Context title', () => {
    const result = renderDiscordContext(standardContextSnapshot)
    expect(result.method).toBe('embed')
    assertEmbed(result)
    expect(result.embed.title).toBe('Context · gpt-4o')
  })

  test('description contains the emoji grid', () => {
    const result = renderDiscordContext(standardContextSnapshot)
    assertEmbed(result)
    expect(result.embed.description).toContain('🟦')
    expect(result.embed.description).toContain('⬜')
  })

  test('has one field per top-level section', () => {
    const result = renderDiscordContext(standardContextSnapshot)
    assertEmbed(result)
    expect(result.embed.fields?.map((f) => f.name)).toEqual([
      '🟦 System prompt',
      '🟩 Memory context',
      '🟨 Conversation history',
      '🟪 Tools',
    ])
  })

  test('section fields list child tokens in their values', () => {
    const result = renderDiscordContext(standardContextSnapshot)
    assertEmbed(result)
    const systemField = result.embed.fields?.find((f) => f.name === '🟦 System prompt')
    expect(systemField?.value).toContain('820')
    expect(systemField?.value).toContain('Base instructions')
    expect(systemField?.value).toContain('Custom instructions')
    expect(systemField?.value).toContain('Provider addendum')
  })

  test('footer shows tokens + percentage', () => {
    const result = renderDiscordContext(standardContextSnapshot)
    assertEmbed(result)
    expect(result.embed.footer).toContain('6,770')
    expect(result.embed.footer).toContain('128,000')
    expect(result.embed.footer).toMatch(/5\.\d%/)
  })

  test('color is green below 50% usage', () => {
    const result = renderDiscordContext(standardContextSnapshot)
    assertEmbed(result)
    expect(result.embed.color).toBe(0x2ecc71)
  })

  test('color is yellow between 50% and 80% usage', () => {
    const result = renderDiscordContext({ ...standardContextSnapshot, totalTokens: 80_000 })
    assertEmbed(result)
    expect(result.embed.color).toBe(0xf1c40f)
  })

  test('color is red above 80% usage', () => {
    const result = renderDiscordContext({ ...standardContextSnapshot, totalTokens: 110_000 })
    assertEmbed(result)
    expect(result.embed.color).toBe(0xe74c3c)
  })

  test('footer omits percentage when maxTokens is null', () => {
    const result = renderDiscordContext({ ...standardContextSnapshot, maxTokens: null })
    assertEmbed(result)
    expect(result.embed.footer).not.toMatch(/%/)
    expect(result.embed.footer).toContain('6,770 tokens')
  })

  test('notes approximate counts in footer when applicable', () => {
    const result = renderDiscordContext({ ...standardContextSnapshot, approximate: true })
    assertEmbed(result)
    expect(result.embed.footer).toMatch(/approximate/i)
  })
})
