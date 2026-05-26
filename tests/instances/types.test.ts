// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type {
  AdminRecord,
  BootstrapResult,
  ContextSettings,
  InstanceConfig,
  InstanceStatus,
  PlatformInstance,
  PlatformInstanceType,
  TaskInstance,
  TaskInstanceType,
} from '../../src/instances/types.js'

describe('instances/types', () => {
  test('TaskInstanceType accepts built-in provider strings', () => {
    const kaneo: TaskInstanceType = 'kaneo'
    const youtrack: TaskInstanceType = 'youtrack'
    expect(kaneo).toBe('kaneo')
    expect(youtrack).toBe('youtrack')
  })

  test('TaskInstanceType accepts contributed provider strings', () => {
    const contributed: TaskInstanceType = 'demo-tracker'
    expect(contributed).toBe('demo-tracker')
  })

  test('TaskInstance shape round-trips correctly', () => {
    const instance: TaskInstance = {
      id: 'inst-1',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid', region: 'eu' },
      status: 'active',
      createdAt: '2026-05-25T00:00:00.000Z',
    }
    expect(instance.type).toBe('demo-tracker')
    expect(instance.config['baseUrl']).toBe('https://demo.invalid')
  })

  test('InstanceConfig is a record of strings', () => {
    const config: InstanceConfig = { key: 'value', another: 'entry' }
    expect(Object.keys(config)).toHaveLength(2)
  })

  test('InstanceStatus covers expected values', () => {
    const statuses: InstanceStatus[] = ['pending', 'active', 'stopped']
    expect(statuses).toHaveLength(3)
  })

  test('PlatformInstanceType covers expected values', () => {
    const types: PlatformInstanceType[] = ['telegram', 'mattermost', 'discord']
    expect(types).toHaveLength(3)
  })

  test('PlatformInstance shape is well-formed', () => {
    const instance: PlatformInstance = {
      id: 'plat-1',
      type: 'telegram',
      config: { token: 'bot:abc' },
      status: 'active',
      createdAt: '2026-05-25T00:00:00.000Z',
    }
    expect(instance.type).toBe('telegram')
  })

  test('ContextSettings shape is well-formed', () => {
    const settings: ContextSettings = {
      contextId: 'ctx-1',
      taskInstanceId: 'task-1',
      platformInstanceId: 'plat-1',
    }
    expect(settings.contextId).toBe('ctx-1')
  })

  test('AdminRecord shape is well-formed', () => {
    const admin: AdminRecord = {
      userId: 'user-1',
      platformInstanceId: 'plat-1',
      createdAt: '2026-05-25T00:00:00.000Z',
    }
    expect(admin.userId).toBe('user-1')
  })

  test('BootstrapResult discriminated union covers bootstrapped and failed cases', () => {
    const success: BootstrapResult = { bootstrapped: true, platformInstanceId: 'p-1', taskInstanceId: 't-1' }
    const failed: BootstrapResult = { bootstrapped: false, reason: 'no-env' }
    expect(success.bootstrapped).toBe(true)
    expect(failed.bootstrapped).toBe(false)
  })
})
