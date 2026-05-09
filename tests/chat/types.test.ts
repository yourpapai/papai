import { describe, expect, it, test } from 'bun:test'
import assert from 'node:assert/strict'

import type {
  ChatCapability,
  ChatProvider,
  ContextRendered,
  ContextSection,
  ContextSnapshot,
  ContextType,
  EmbedField,
  EmbedOptions,
  IncomingInteraction,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from '../../src/chat/types.js'

describe('ThreadCapabilities', () => {
  it('should have correct structure', () => {
    const caps: ThreadCapabilities = {
      supportsThreads: true,
      canCreateThreads: false,
      threadScope: 'message',
    }
    expect(caps.supportsThreads).toBe(true)
    expect(caps.canCreateThreads).toBe(false)
    expect(caps.threadScope).toBe('message')
  })
})

describe('ResolveUserContext', () => {
  test('has contextId and contextType', () => {
    const ctx: ResolveUserContext = { contextId: 'c1', contextType: 'group' }
    expect(ctx.contextId).toBe('c1')
    expect(ctx.contextType).toBe('group')
  })

  test('contextType accepts dm and group', () => {
    const dm: ContextType = 'dm'
    const group: ContextType = 'group'
    const ctxDm: ResolveUserContext = { contextId: 'u1', contextType: dm }
    const ctxGroup: ResolveUserContext = { contextId: 'g1', contextType: group }
    expect(ctxDm.contextType).toBe('dm')
    expect(ctxGroup.contextType).toBe('group')
  })
})

describe('IncomingMessage context metadata', () => {
  test('supports optional contextName and contextParentName fields', () => {
    const message = {
      user: { id: 'u1', username: 'alice', isAdmin: false },
      contextId: 'group-1',
      contextType: 'group' as const,
      contextName: 'Operations',
      contextParentName: 'Platform',
      isMentioned: true,
      text: 'hello',
    }

    expect(message.contextName).toBe('Operations')
    expect(message.contextParentName).toBe('Platform')
  })
})

const resolveUserIdByUsername = new Map<string, string>([['testuser', 'user123']])

function resolveUserIdMock(username: string, _context: ResolveUserContext): Promise<string | null> {
  return Promise.resolve(resolveUserIdByUsername.get(username) ?? null)
}

describe('ChatProvider interface', () => {
  test('resolveUserId accepts username and context', async () => {
    const mockProvider: ChatProvider = {
      name: 'mock',
      threadCapabilities: {
        supportsThreads: true,
        canCreateThreads: false,
        threadScope: 'message',
      },
      capabilities: new Set<ChatCapability>(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: (): void => {},
      onMessage: (): void => {},
      sendMessage: async (): Promise<void> => {},
      resolveUserId: resolveUserIdMock,
      renderContext: () => ({ method: 'text', content: '' }),
      start: async (): Promise<void> => {},
      stop: async (): Promise<void> => {},
    }

    const context: ResolveUserContext = { contextId: 'c1', contextType: 'group' }
    const result = await mockProvider.resolveUserId?.('testuser', context)
    expect(result).toBe('user123')

    const notFound = await mockProvider.resolveUserId?.('nonexistent', context)
    expect(notFound).toBeNull()
  })

  test('ChatProvider interface includes capability metadata and optional interaction hooks', () => {
    const capabilities: ChatCapability[] = ['messages.buttons', 'interactions.callbacks']

    const mockProvider: ChatProvider = {
      name: 'mock',
      threadCapabilities: {
        supportsThreads: true,
        canCreateThreads: false,
        threadScope: 'message',
      },
      capabilities: new Set(capabilities),
      traits: { observedGroupMessages: 'all', callbackDataMaxLength: 64 },
      configRequirements: [{ key: 'BOT_TOKEN', label: 'Bot Token', required: true }],
      registerCommand: (): void => {},
      onMessage: (): void => {},
      onInteraction: (_handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      resolveUserId: (): Promise<string | null> => Promise.resolve('user123'),
      setCommands: (_adminUserId: string): Promise<void> => Promise.resolve(),
      renderContext: () => ({ method: 'text', content: '' }),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }

    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'user123', username: 'alice', isAdmin: false },
      contextId: 'ctx-1',
      contextType: 'dm',
      storageContextId: 'ctx-1',
      callbackData: 'cfg:setup',
    }

    expect(mockProvider.capabilities.has('messages.buttons')).toBe(true)
    expect(mockProvider.traits.callbackDataMaxLength).toBe(64)
    expect(interaction.callbackData).toBe('cfg:setup')
  })
})

describe('ContextSnapshot and related types', () => {
  test('ContextSection has required fields and optional children/detail', () => {
    const section: ContextSection = {
      label: 'System prompt',
      tokens: 1000,
    }
    expect(section.label).toBe('System prompt')
    expect(section.tokens).toBe(1000)
    expect(section.children).toBeUndefined()
    expect(section.detail).toBeUndefined()
  })

  test('ContextSection accepts children and detail', () => {
    const child: ContextSection = { label: 'Base instructions', tokens: 800 }
    const section: ContextSection = {
      label: 'System prompt',
      tokens: 1000,
      children: [child],
      detail: '3 children',
    }
    expect(section.children).toHaveLength(1)
    expect(section.detail).toBe('3 children')
  })

  test('ContextSnapshot has all required fields', () => {
    const snapshot: ContextSnapshot = {
      modelName: 'gpt-4o',
      sections: [
        { label: 'System prompt', tokens: 1000 },
        { label: 'Tools', tokens: 500 },
      ],
      totalTokens: 1500,
      maxTokens: 128_000,
      approximate: false,
    }
    expect(snapshot.modelName).toBe('gpt-4o')
    expect(snapshot.totalTokens).toBe(1500)
    expect(snapshot.maxTokens).toBe(128_000)
    expect(snapshot.approximate).toBe(false)
    expect(snapshot.sections).toHaveLength(2)
  })

  test('ContextSnapshot accepts null maxTokens for unknown models', () => {
    const snapshot: ContextSnapshot = {
      modelName: 'unknown-model',
      sections: [],
      totalTokens: 0,
      maxTokens: null,
      approximate: true,
    }
    expect(snapshot.maxTokens).toBeNull()
    expect(snapshot.approximate).toBe(true)
  })

  test('EmbedField has name, value and optional inline', () => {
    const field: EmbedField = {
      name: 'System prompt',
      value: '1000 tokens',
    }
    expect(field.name).toBe('System prompt')
    expect(field.value).toBe('1000 tokens')
    expect(field.inline).toBeUndefined()

    const inlineField: EmbedField = {
      name: 'Tools',
      value: '500 tokens',
      inline: true,
    }
    expect(inlineField.inline).toBe(true)
  })

  test('EmbedOptions has required title and description', () => {
    const embed: EmbedOptions = {
      title: 'Context · gpt-4o',
      description: '🟦🟦⬜',
    }
    expect(embed.title).toBe('Context · gpt-4o')
    expect(embed.description).toBe('🟦🟦⬜')
    expect(embed.fields).toBeUndefined()
    expect(embed.footer).toBeUndefined()
    expect(embed.color).toBeUndefined()
  })

  test('EmbedOptions accepts all optional fields', () => {
    const embed: EmbedOptions = {
      title: 'Context · gpt-4o',
      description: '🟦🟦⬜',
      fields: [
        { name: 'System prompt', value: '1000 tk' },
        { name: 'Tools', value: '500 tk', inline: true },
      ],
      footer: '1500 / 128000 tokens',
      color: 0x2ecc71,
    }
    expect(embed.fields).toHaveLength(2)
    expect(embed.footer).toBe('1500 / 128000 tokens')
    expect(embed.color).toBe(0x2ecc71)
  })

  test('ContextRendered discriminated union - text method', () => {
    const rendered: ContextRendered = {
      method: 'text',
      content: 'Raw text content',
    }
    expect(rendered.method).toBe('text')
    assert(rendered.method === 'text')
    expect(rendered.content).toBe('Raw text content')
  })

  test('ContextRendered discriminated union - formatted method', () => {
    const rendered: ContextRendered = {
      method: 'formatted',
      content: '**markdown** content',
    }
    expect(rendered.method).toBe('formatted')
    assert(rendered.method === 'formatted')
    expect(rendered.content).toBe('**markdown** content')
  })

  test('ContextRendered discriminated union - embed method', () => {
    const rendered: ContextRendered = {
      method: 'embed',
      embed: {
        title: 'Context · gpt-4o',
        description: '🟦🟦⬜',
        footer: '1500 / 128000 tokens',
        color: 0x2ecc71,
      },
    }
    expect(rendered.method).toBe('embed')
    assert(rendered.method === 'embed')
    expect(rendered.embed.title).toBe('Context · gpt-4o')
    expect(rendered.embed.color).toBe(0x2ecc71)
  })
})
