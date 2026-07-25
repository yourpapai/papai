// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ReplyFn } from '../../src/chat/types.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { deleteTaskInstance, insertTaskInstance } from '../../src/instances/task-store.js'
import { maybeAutoProvisionProvider } from '../../src/providers/auto-provision.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const PLUGIN_ID = 'auto-provision-test-plugin'
const PROVIDER_TYPE = 'auto-provision-test-tracker'
const CONTEXT_ID = 'ctx-auto-1'
const TASK_INSTANCE_ID = 'task-inst-auto-1'
const CHAT_USER_ID = 'chat-user-1'
const PLATFORM_INSTANCE_ID = 'telegram-default'

const makeReply = (): ReplyFn =>
  ({
    text: mock(() => Promise.resolve()),
    formatted: mock(() => Promise.resolve()),
    typing: mock(() => {}),
    buttons: mock(() => Promise.resolve(undefined)),
  }) as ReplyFn

const registerAutoProvisionHook = (
  hook: (ctx: {
    contextId: string
    chatUserId: string
    username: string | null
    reply: ReplyFn
  }) => Promise<boolean> | boolean,
): void => {
  registerContributedTaskProviderType(PROVIDER_TYPE, {
    pluginId: PLUGIN_ID,
    factory: () => {
      throw new Error('factory should not be called by maybeAutoProvisionProvider')
    },
    capabilities: new Set(),
    displayName: 'Auto-Provision Test',
    autoProvision: hook,
  })
}

describe('maybeAutoProvisionProvider', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '4'.repeat(64)
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(PLUGIN_ID)
  })

  test('returns false when context has no settings row', async () => {
    const hook = mock(() => Promise.resolve(true))
    registerAutoProvisionHook(hook)

    const result = await maybeAutoProvisionProvider(makeReply(), CONTEXT_ID, CHAT_USER_ID, 'alice')

    expect(result).toBe(false)
    expect(hook).toHaveBeenCalledTimes(0)
  })

  test('returns false when assigned task instance has been removed', async () => {
    const hook = mock(() => Promise.resolve(true))
    registerAutoProvisionHook(hook)
    insertTaskInstance({
      id: TASK_INSTANCE_ID,
      type: PROVIDER_TYPE,
      config: {},
      status: 'active',
    })
    setContextSettings({
      contextId: CONTEXT_ID,
      taskInstanceId: TASK_INSTANCE_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })
    deleteTaskInstance(TASK_INSTANCE_ID)

    const result = await maybeAutoProvisionProvider(makeReply(), CONTEXT_ID, CHAT_USER_ID, 'alice')

    expect(result).toBe(false)
    expect(hook).toHaveBeenCalledTimes(0)
  })

  test('returns false when assigned task instance is not active', async () => {
    const hook = mock(() => Promise.resolve(true))
    registerAutoProvisionHook(hook)
    insertTaskInstance({
      id: TASK_INSTANCE_ID,
      type: PROVIDER_TYPE,
      config: {},
      status: 'stopped',
    })
    setContextSettings({
      contextId: CONTEXT_ID,
      taskInstanceId: TASK_INSTANCE_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })

    const result = await maybeAutoProvisionProvider(makeReply(), CONTEXT_ID, CHAT_USER_ID, 'alice')

    expect(result).toBe(false)
    expect(hook).toHaveBeenCalledTimes(0)
  })

  test('returns false when provider type has no contributed descriptor', async () => {
    const hook = mock(() => Promise.resolve(true))
    registerAutoProvisionHook(hook)
    insertTaskInstance({
      id: TASK_INSTANCE_ID,
      type: 'unregistered-type',
      config: {},
      status: 'active',
    })
    setContextSettings({
      contextId: CONTEXT_ID,
      taskInstanceId: TASK_INSTANCE_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })

    const result = await maybeAutoProvisionProvider(makeReply(), CONTEXT_ID, CHAT_USER_ID, 'alice')

    expect(result).toBe(false)
    expect(hook).toHaveBeenCalledTimes(0)
  })

  test('returns false when descriptor has no autoProvision hook', async () => {
    registerContributedTaskProviderType(PROVIDER_TYPE, {
      pluginId: PLUGIN_ID,
      factory: () => {
        throw new Error('not used')
      },
      capabilities: new Set(),
      displayName: 'No-Hook Test',
    })
    insertTaskInstance({
      id: TASK_INSTANCE_ID,
      type: PROVIDER_TYPE,
      config: {},
      status: 'active',
    })
    setContextSettings({
      contextId: CONTEXT_ID,
      taskInstanceId: TASK_INSTANCE_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })

    const result = await maybeAutoProvisionProvider(makeReply(), CONTEXT_ID, CHAT_USER_ID, 'alice')

    expect(result).toBe(false)
  })

  test('returns false and swallows errors when autoProvision hook throws', async () => {
    const hook = mock(() => Promise.reject(new Error('provision failed')))
    registerAutoProvisionHook(hook)
    insertTaskInstance({
      id: TASK_INSTANCE_ID,
      type: PROVIDER_TYPE,
      config: {},
      status: 'active',
    })
    setContextSettings({
      contextId: CONTEXT_ID,
      taskInstanceId: TASK_INSTANCE_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })

    const result = await maybeAutoProvisionProvider(makeReply(), CONTEXT_ID, CHAT_USER_ID, 'alice')

    expect(result).toBe(false)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  test('invokes hook with chat context and returns its result on the happy path', async () => {
    const hook = mock((ctx: { contextId: string; chatUserId: string; username: string | null; reply: ReplyFn }) => {
      expect(ctx.contextId).toBe(CONTEXT_ID)
      expect(ctx.chatUserId).toBe(CHAT_USER_ID)
      expect(ctx.username).toBe('alice')
      expect(typeof ctx.reply.text).toBe('function')
      return Promise.resolve(true)
    })
    registerAutoProvisionHook(hook)
    insertTaskInstance({
      id: TASK_INSTANCE_ID,
      type: PROVIDER_TYPE,
      config: {},
      status: 'active',
    })
    setContextSettings({
      contextId: CONTEXT_ID,
      taskInstanceId: TASK_INSTANCE_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })

    const result = await maybeAutoProvisionProvider(makeReply(), CONTEXT_ID, CHAT_USER_ID, 'alice')

    expect(result).toBe(true)
    expect(hook).toHaveBeenCalledTimes(1)
    deleteTaskInstance(TASK_INSTANCE_ID)
  })
})
