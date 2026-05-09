import { beforeEach, describe, expect, test } from 'bun:test'

import {
  resolveTelegramGroupDisplayLabel,
  resolveTelegramUserDisplayLabel,
} from '../../../src/chat/telegram/group-display-resolution.js'
import type { ChatProvider } from '../../../src/chat/types.js'
import {
  findGroupUserObservation,
  upsertGroupUserObservation,
  upsertKnownGroupContext,
} from '../../../src/group-settings/registry.js'
import { createMockChat, mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type CreateMockChatOptions = NonNullable<Parameters<typeof createMockChat>[0]>

const createTelegramChat = (overrides: CreateMockChatOptions): ChatProvider => ({
  ...createMockChat(overrides),
  name: 'telegram',
})

describe('telegram group display resolution', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('prefers live group titles over cached known-group labels', async () => {
    upsertKnownGroupContext({
      contextId: '-1001',
      provider: 'telegram',
      displayName: 'Cached Operations',
      parentName: null,
    })

    const chat = createTelegramChat({
      resolveGroupLabel: (): Promise<string | null> => Promise.resolve('Live Operations'),
    })

    expect(await resolveTelegramGroupDisplayLabel(chat, '-1001')).toBe('Live Operations')
  })

  test('falls back to cached known-group labels when live group lookup returns null', async () => {
    upsertKnownGroupContext({
      contextId: '-1001',
      provider: 'telegram',
      displayName: 'Cached Operations',
      parentName: null,
    })

    const chat = createTelegramChat({
      resolveGroupLabel: (): Promise<string | null> => Promise.resolve(null),
    })

    expect(await resolveTelegramGroupDisplayLabel(chat, '-1001')).toBe('Cached Operations')
  })

  test('falls back to cached observed user labels when live member lookup returns null', async () => {
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: '-1001',
      userId: '42',
      username: 'itsmike',
      displayLabel: 'John Johnson (@itsmike)',
    })

    const chat = createTelegramChat({
      resolveUserLabel: (): Promise<string | null> => Promise.resolve(null),
    })

    expect(await resolveTelegramUserDisplayLabel(chat, '-1001', '42')).toBe('John Johnson (@itsmike)')
  })

  test('caches successful live user labels for later fallback', async () => {
    const chat = createTelegramChat({
      resolveUserLabel: (): Promise<string | null> => Promise.resolve('Jane Example (@jane)'),
    })

    expect(await resolveTelegramUserDisplayLabel(chat, '-1001', '99')).toBe('Jane Example (@jane)')
    expect(findGroupUserObservation('telegram', '-1001', '99')?.displayLabel).toBe('Jane Example (@jane)')
  })
})
