import { describe, expect, test } from 'bun:test'

import type { ContextSection, ContextSnapshot } from '../../src/chat/context-types.js'

describe('context-types', () => {
  test('ContextSection has required fields', () => {
    const section: ContextSection = { label: 'test', tokens: 100 }
    expect(section.label).toBe('test')
    expect(section.tokens).toBe(100)
  })

  test('ContextSnapshot has required fields', () => {
    const snapshot: ContextSnapshot = {
      modelName: 'gpt-4o',
      sections: [],
      totalTokens: 0,
      maxTokens: null,
      approximate: false,
    }
    expect(snapshot.modelName).toBe('gpt-4o')
    expect(snapshot.maxTokens).toBeNull()
  })
})
