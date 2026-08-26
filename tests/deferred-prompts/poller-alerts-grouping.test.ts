// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import type { ChatProvider } from '../../src/chat/types.js'
import * as alertsModule from '../../src/deferred-prompts/alerts.js'
import {
  groupAlertsByInstance,
  handleUnresolvableProvider,
  routableContextGroups,
} from '../../src/deferred-prompts/poller-alerts-grouping.js'
import type { AlertPrompt } from '../../src/deferred-prompts/types.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import {
  createMockChat,
  mockLogger,
  seedTestPlatformInstance,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

const scopedGroupId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'group-1' })

const makeAlert = (overrides: Partial<Pick<AlertPrompt, 'id' | 'taskInstanceId'>> = {}): AlertPrompt => ({
  type: 'alert',
  id: overrides.id ?? 'alert-1',
  createdByUserId: 'user-1',
  createdByUsername: null,
  deliveryTarget: {
    contextId: 'group-1',
    storageContextId: scopedGroupId,
    contextType: 'group',
    threadId: null,
    audience: 'personal',
    mentionUserIds: [],
    createdByUserId: 'user-1',
    createdByUsername: null,
  },
  prompt: 'watch tasks',
  condition: { field: 'task.status', op: 'changed_to', value: 'done' },
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastTriggeredAt: null,
  cooldownMinutes: 0,
  executionMetadata: { delivery_brief: '', context_snapshot: null },
  matchedTaskIds: [],
  taskInstanceId: overrides.taskInstanceId ?? null,
})

describe('groupAlertsByInstance', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an alert pin wins over the context current assignment', () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    seedTestTaskInstance({ id: 'ti-current' })
    setContextSettings({ contextId: scopedGroupId, taskInstanceId: 'ti-current', platformInstanceId: 'pi-1' })

    const groups = groupAlertsByInstance([makeAlert({ taskInstanceId: 'ti-a' })])

    expect(groups.size).toBe(1)
    const group = [...groups.values()][0]!
    expect(group.configContextId).toBe(scopedGroupId)
    expect(group.pinnedTaskInstanceId).toBe('ti-a')
  })

  test('null-pinned alerts fall back to the settings instance and keep the group pin null', () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    seedTestTaskInstance({ id: 'ti-current' })
    setContextSettings({ contextId: scopedGroupId, taskInstanceId: 'ti-current', platformInstanceId: 'pi-1' })

    const groups = groupAlertsByInstance([makeAlert()])

    expect(groups.size).toBe(1)
    const group = [...groups.values()][0]!
    expect(group.pinnedTaskInstanceId).toBeNull()
  })

  test('alerts with no pin and no settings land in a null-instance group', () => {
    const groups = groupAlertsByInstance([makeAlert()])

    expect(groups.size).toBe(1)
    const group = [...groups.values()][0]!
    expect(group.pinnedTaskInstanceId).toBeNull()
  })

  test('a null-pin member joining a pinned group upgrades the group pin', () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    seedTestTaskInstance({ id: 'ti-a' })
    setContextSettings({ contextId: scopedGroupId, taskInstanceId: 'ti-a', platformInstanceId: 'pi-1' })
    const pinned = makeAlert({ id: 'alert-pinned', taskInstanceId: 'ti-a' })
    const unpinned = makeAlert({ id: 'alert-unpinned' })

    const groups = groupAlertsByInstance([unpinned, pinned])

    expect(groups.size).toBe(1)
    const group = [...groups.values()][0]!
    expect(group.pinnedTaskInstanceId).toBe('ti-a')
    expect(group.contextGroups.get(scopedGroupId)).toHaveLength(2)
  })

  test('same config context with different effective instances forms separate groups', () => {
    const groups = groupAlertsByInstance([
      makeAlert({ id: 'a1', taskInstanceId: 'ti-a' }),
      makeAlert({ id: 'a2', taskInstanceId: 'ti-b' }),
    ])

    expect(groups.size).toBe(2)
    expect(
      [...groups.values()].map((g) => g.pinnedTaskInstanceId).sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['ti-a', 'ti-b'])
  })
})

describe('routableContextGroups', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('keeps groups whose delivery target resolves a platform instance and drops unroutable ones', () => {
    const chat: ChatProvider = createMockChat()
    const routable = new Map([[scopedGroupId, [makeAlert()]]])
    const unroutableDm = makeAlert({ id: 'alert-dm' })
    unroutableDm.deliveryTarget = {
      contextId: 'raw-user',
      contextType: 'dm',
      threadId: null,
      audience: 'personal',
      mentionUserIds: [],
      createdByUserId: 'raw-user',
      createdByUsername: null,
    }
    const contextGroups = new Map([
      [scopedGroupId, routable.get(scopedGroupId)!],
      ['raw-user', [unroutableDm]],
    ])

    const result = routableContextGroups(contextGroups, chat)

    expect([...result.keys()]).toEqual([scopedGroupId])
  })
})

describe('handleUnresolvableProvider', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('a null pin keeps the warn-and-retry behavior without cancelling', () => {
    const cancelSpy = spyOn(alertsModule, 'cancelActiveAlertsPinnedToInstance').mockImplementation(() => {})

    try {
      handleUnresolvableProvider('ctx-1', null)
    } finally {
      cancelSpy.mockRestore()
    }

    expect(cancelSpy).not.toHaveBeenCalled()
  })

  test('a non-null pin cancels its alerts scoped to the config context', () => {
    const cancelCalls: Array<[string, string | undefined]> = []
    const cancelSpy = spyOn(alertsModule, 'cancelActiveAlertsPinnedToInstance').mockImplementation(
      (taskInstanceId: string, configContextId?: string): void => {
        cancelCalls.push([taskInstanceId, configContextId])
      },
    )

    try {
      handleUnresolvableProvider('ctx-1', 'ti-a')
    } finally {
      cancelSpy.mockRestore()
    }

    expect(cancelCalls).toEqual([['ti-a', 'ctx-1']])
  })
})
