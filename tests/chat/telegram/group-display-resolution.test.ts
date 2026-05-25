// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
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
    const platformInstanceId: string | undefined = undefined

    expect(await resolveTelegramGroupDisplayLabel(chat, '-1001', platformInstanceId)).toBe('Live Operations')
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
    const platformInstanceId: string | undefined = undefined

    expect(await resolveTelegramGroupDisplayLabel(chat, '-1001', platformInstanceId)).toBe('Cached Operations')
  })

  test('falls back to scoped cached known-group labels before legacy native labels', async () => {
    const scopedContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '-1001' })
    upsertKnownGroupContext({
      contextId: '-1001',
      provider: 'telegram',
      displayName: 'Legacy Cached Operations',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: scopedContextId,
      provider: 'telegram',
      displayName: 'Scoped Cached Operations',
      parentName: null,
    })

    const chat = createTelegramChat({
      resolveGroupLabel: (): Promise<string | null> => Promise.resolve(null),
    })

    expect(await resolveTelegramGroupDisplayLabel(chat, '-1001', 'telegram-default')).toBe('Scoped Cached Operations')
  })

  test('falls back to legacy native known-group labels when scoped cache is absent', async () => {
    upsertKnownGroupContext({
      contextId: '-1001',
      provider: 'telegram',
      displayName: 'Legacy Cached Operations',
      parentName: null,
    })

    const chat = createTelegramChat({
      resolveGroupLabel: (): Promise<string | null> => Promise.resolve(null),
    })

    expect(await resolveTelegramGroupDisplayLabel(chat, '-1001', 'telegram-default')).toBe('Legacy Cached Operations')
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

  test('prefers live user labels over cached observed user labels', async () => {
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: '-1001',
      userId: '42',
      username: 'itsmike',
      displayLabel: 'Cached John (@itsmike)',
    })

    const chat = createTelegramChat({
      resolveUserLabel: (): Promise<string | null> => Promise.resolve('Live John (@itsmike)'),
    })

    expect(await resolveTelegramUserDisplayLabel(chat, '-1001', '42')).toBe('Live John (@itsmike)')
  })

  test('caches successful live user labels for later fallback', async () => {
    const chat = createTelegramChat({
      resolveUserLabel: (): Promise<string | null> => Promise.resolve('Jane Example (@jane)'),
    })

    expect(await resolveTelegramUserDisplayLabel(chat, '-1001', '99')).toBe('Jane Example (@jane)')
    const cachedUser = findGroupUserObservation('telegram', '-1001', '99')

    expect(cachedUser).not.toBeNull()
    assert.ok(cachedUser !== null)
    expect(cachedUser.displayLabel).toBe('Jane Example (@jane)')
  })
})
