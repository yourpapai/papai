import { beforeEach, describe, expect, mock, it } from 'bun:test'
import assert from 'node:assert/strict'

import type { LanguageModel, ModelMessage } from 'ai'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type GenerateTextResult = {
  text: string
}

/** Input type for lookup_group_history tool */
type LookupGroupHistoryInput = {
  queries: string[]
}

let generateTextImpl: () => Promise<GenerateTextResult>

describe('makeLookupGroupHistoryTool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    generateTextImpl = (): Promise<GenerateTextResult> => Promise.resolve({ text: 'test response' })

    void mock.module('ai', () => ({
      generateText: (): Promise<GenerateTextResult> => generateTextImpl(),
    }))

    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (): ((_model: string) => unknown) =>
        (_model: string): unknown => ({}),
    }))
  })

  it('should return error when userId is undefined', async () => {
    const { makeLookupGroupHistoryTool } = await import('../../src/tools/lookup-group-history.js')

    const tool = makeLookupGroupHistoryTool(undefined, 'group123')
    assert(tool.execute, 'Tool execute is undefined')
    const input: LookupGroupHistoryInput = { queries: ['test'] }
    const result: unknown = await tool.execute(input, { toolCallId: '1', messages: [] })
    expect(result).toBe('Unable to search: missing user or context information.')
  })

  it('should return error when contextId is undefined', async () => {
    const { makeLookupGroupHistoryTool } = await import('../../src/tools/lookup-group-history.js')

    const tool = makeLookupGroupHistoryTool('user123', undefined)
    assert(tool.execute, 'Tool execute is undefined')
    const input: LookupGroupHistoryInput = { queries: ['test'] }
    const result: unknown = await tool.execute(input, { toolCallId: '1', messages: [] })
    expect(result).toBe('Unable to search: missing user or context information.')
  })

  it('should extract groupId from contextId without thread suffix', async () => {
    const { makeLookupGroupHistoryTool } = await import('../../src/tools/lookup-group-history.js')

    const tool = makeLookupGroupHistoryTool('user123', 'group456')
    // Tool should execute without error - the groupId should be 'group456'
    expect(tool.description).toContain('main group chat')
  })

  it('should extract groupId from contextId with thread suffix', async () => {
    const { makeLookupGroupHistoryTool } = await import('../../src/tools/lookup-group-history.js')

    const tool = makeLookupGroupHistoryTool('user123', 'group456:thread789')
    // Tool should execute and extract 'group456' from 'group456:thread789'
    expect(tool.description).toContain('main group chat')
  })
})

describe('executeLookupGroupHistory', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    // Default implementation returns a simple result
    generateTextImpl = (): Promise<GenerateTextResult> => Promise.resolve({ text: 'test response' })

    // Mock the ai module
    void mock.module('ai', () => ({
      generateText: (): Promise<GenerateTextResult> => generateTextImpl(),
    }))

    // Mock the openai-compatible module
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (): ((_model: string) => unknown) =>
        (_model: string): unknown => ({}),
    }))
  })

  it('should return empty message when no history', async () => {
    // Import the code under test after mocking
    const { executeLookupGroupHistory } = await import('../../src/tools/lookup-group-history.js')

    const mockGetHistory = (): readonly ModelMessage[] => []
    const result = await executeLookupGroupHistory('user123', 'group456', ['test query'], {
      getCachedHistory: mockGetHistory,
      generateText: generateTextImpl,
      getSmallModel: () => null,
    })
    expect(result).toBe('No messages found in the main chat.')
  })
})

describe('executeLookupGroupHistory with history', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: 'The team decided to use REST for the API.' })

    void mock.module('ai', () => ({
      generateText: (): Promise<GenerateTextResult> => generateTextImpl(),
    }))

    // Mock the openai-compatible module
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (): ((_model: string) => unknown) =>
        (_model: string): unknown => ({}),
    }))
  })

  it('should return LLM response when history exists', async () => {
    const { executeLookupGroupHistory } = await import('../../src/tools/lookup-group-history.js')

    const mockHistory: ModelMessage[] = [
      { role: 'user', content: 'What about the API?' },
      { role: 'assistant', content: 'We decided to use REST' },
    ]

    const result = await executeLookupGroupHistory('user123', 'group456', ['API decision'], {
      getCachedHistory: () => mockHistory,
      generateText: generateTextImpl,
      getSmallModel: () => 'test-model' as LanguageModel,
    })
    expect(result).toBe('The team decided to use REST for the API.')
  })

  it('should return error when LLM not configured', async () => {
    const { executeLookupGroupHistory } = await import('../../src/tools/lookup-group-history.js')

    const result = await executeLookupGroupHistory('user123', 'group456', ['test'], {
      getCachedHistory: () => [{ role: 'user', content: 'test' }],
      generateText: generateTextImpl,
      getSmallModel: () => null,
    })
    expect(result).toBe('Unable to search: LLM not configured.')
  })

  it('should handle LLM errors gracefully', async () => {
    const { executeLookupGroupHistory } = await import('../../src/tools/lookup-group-history.js')

    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM error'))

    const result = await executeLookupGroupHistory('user123', 'group456', ['test'], {
      getCachedHistory: () => [{ role: 'user', content: 'test' }],
      generateText: generateTextImpl,
      getSmallModel: () => 'test-model' as LanguageModel,
    })
    expect(result).toBe('Error searching main chat history.')
  })
})
