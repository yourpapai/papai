// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { ChatCapability, ChatProvider } from '../../src/chat/types.js'
import type { PlatformInstance, TaskInstance } from '../../src/instances/types.js'
import type { PluginCompatibilityInstance } from '../../src/plugins/registry.js'
import { collectStartupCompatibilityInstances } from '../../src/plugins/startup-compatibility.js'
import { createMockChat } from '../utils/test-helpers.js'

const platformInstance = (id: string, status: PlatformInstance['status']): PlatformInstance => ({
  id,
  type: 'telegram',
  config: { token: 'x' },
  status,
  createdAt: 'now',
})

const taskInstance = (id: string, type: TaskInstance['type'], status: TaskInstance['status']): TaskInstance => ({
  id,
  type,
  config: { url: `https://${id}.invalid` },
  status,
  createdAt: 'now',
})

const singleCompatibilityEntry = (result: readonly PluginCompatibilityInstance[]): PluginCompatibilityInstance => {
  const [entry] = result
  if (entry === undefined) throw new Error('missing compatibility entry')
  return entry
}

const capabilitySetForId = (capabilities: Record<string, Set<ChatCapability>>, id: string): Set<ChatCapability> => {
  const result = capabilities[id]
  if (result === undefined) throw new Error(`missing capabilities for ${id}`)
  return result
}

describe('startup plugin compatibility collection', () => {
  test('builds compatibility entries from active task and platform instances', () => {
    const router = new ChatRouter(
      (_id, _type, _config): ChatProvider =>
        createMockChat({ capabilities: new Set<ChatCapability>(['messages.buttons']) }),
    )
    router.addInstance('telegram-a', 'telegram', { token: 'x' })

    const result = collectStartupCompatibilityInstances(
      router,
      [taskInstance('yt-a', 'youtrack', 'active'), taskInstance('kaneo-stopped', 'kaneo', 'stopped')],
      [platformInstance('telegram-a', 'active'), platformInstance('telegram-stopped', 'stopped')],
    )

    expect(result).toHaveLength(1)
    const entry = singleCompatibilityEntry(result)
    expect(entry.taskCapabilities.has('workItems.list')).toBe(true)
    expect(entry.chatCapabilities.has('messages.buttons')).toBe(true)
  })

  test('builds a Cartesian product of active task and chat capability sets', () => {
    const chatCapabilities: Record<string, Set<ChatCapability>> = {
      'discord-a': new Set<ChatCapability>(['users.resolve']),
      'telegram-a': new Set<ChatCapability>(['messages.buttons']),
    }
    const router = new ChatRouter(
      (id): ChatProvider => createMockChat({ capabilities: capabilitySetForId(chatCapabilities, id) }),
    )
    router.addInstance('telegram-a', 'telegram', { token: 'x' })
    router.addInstance('discord-a', 'discord', { token: 'x' })

    const result = collectStartupCompatibilityInstances(
      router,
      [taskInstance('yt-a', 'youtrack', 'active'), taskInstance('kaneo-a', 'kaneo', 'active')],
      [platformInstance('telegram-a', 'active'), { ...platformInstance('discord-a', 'active'), type: 'discord' }],
    )

    expect(result).toHaveLength(4)
    expect(result.filter((entry) => entry.taskCapabilities.has('workItems.list'))).toHaveLength(2)
    expect(result.filter((entry) => entry.chatCapabilities.has('messages.buttons'))).toHaveLength(2)
  })

  test('uses an empty capability set for a missing side', () => {
    const router = new ChatRouter(() => createMockChat())

    const result = collectStartupCompatibilityInstances(router, [], [])

    expect(result).toHaveLength(1)
    const entry = singleCompatibilityEntry(result)
    expect(entry.taskCapabilities.size).toBe(0)
    expect(entry.chatCapabilities.size).toBe(0)
  })
})
