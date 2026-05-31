// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { taskInstances } from '../../src/db/schema.js'
import { insertTaskInstance, listTaskInstancesSafe } from '../../src/instances/task-store.js'
import type { UpdateTaskInstanceInput } from '../../src/instances/task-store.js'
import type { TaskInstance } from '../../src/instances/types.js'
import {
  deactivateContributedTaskProviderTypes,
  unregisterContributedTaskProviderTypes,
} from '../../src/plugins/task-provider-lifecycle.js'
import type { DeactivateContributedTaskProviderTypesDeps } from '../../src/plugins/task-provider-lifecycle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('task-provider-lifecycle', () => {
  let deps: DeactivateContributedTaskProviderTypesDeps

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '2'.repeat(64)

    deps = {
      listTypesForPlugin: (_pluginId: string): string[] => [],
      unregisterTypesForPlugin: (_pluginId: string): string[] => [],
      listTaskInstances: (): TaskInstance[] => listTaskInstancesSafe().instances,
      updateTaskInstance: (_id: string, _patch: UpdateTaskInstanceInput): void => undefined,
    }
  })

  test('unregisterContributedTaskProviderTypes returns empty when no types registered', () => {
    const result = unregisterContributedTaskProviderTypes('test-plugin', {
      unregisterTypesForPlugin: (_pluginId: string): string[] => [],
    })
    expect(result).toEqual([])
  })

  test('deactivateContributedTaskProviderTypes returns empty when plugin has no provider types', () => {
    const result = deactivateContributedTaskProviderTypes('test-plugin', deps)
    expect(result).toEqual([])
  })

  test('deactivateContributedTaskProviderTypes degrades gracefully when a task_instances row is undecryptable', () => {
    insertTaskInstance({
      id: 'good',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid' },
      status: 'active',
    })
    getDrizzleDb()
      .insert(taskInstances)
      .values({ id: 'bad-task', type: 'demo-tracker', config: 'not-base64', status: 'active' })
      .run()

    const stoppedIds: string[] = []
    const gracefulDeps: DeactivateContributedTaskProviderTypesDeps = {
      listTypesForPlugin: (_pluginId: string): string[] => ['demo-tracker'],
      unregisterTypesForPlugin: (_pluginId: string): string[] => ['demo-tracker'],
      listTaskInstances: (): TaskInstance[] => listTaskInstancesSafe().instances,
      updateTaskInstance: (id: string, _patch: UpdateTaskInstanceInput): void => {
        stoppedIds.push(id)
      },
    }

    expect(() => deactivateContributedTaskProviderTypes('demo-plugin', gracefulDeps)).not.toThrow()
    expect(stoppedIds).toContain('good')
    expect(stoppedIds).not.toContain('bad-task')
  })
})
