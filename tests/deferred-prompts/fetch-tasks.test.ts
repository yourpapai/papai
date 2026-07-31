// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  ProviderScopeMissingError,
  requireProviderRequestScope,
  type ActorProviderRequestScope,
  type ProviderRequestScope,
} from '../../src/analytics/provider-request-scope.js'
import { enrichTasks, fetchAllTasks } from '../../src/deferred-prompts/fetch-tasks.js'
import type { Task } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger } from '../utils/test-helpers.js'

const lightTasks: Task[] = [
  { id: 'task-1', title: 'One', url: 'http://test/1' },
  { id: 'task-2', title: 'Two', url: 'http://test/2' },
]

/** getTask mock that rejects for a specific task id — kept at module scope so the
 *  linter's no-conditional-in-test rule doesn't flag the branch. */
const createFailingGetTask =
  (failId: string) =>
  (taskId: string): Promise<Task> =>
    taskId === failId
      ? Promise.reject(new Error('getTask boom'))
      : Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` })

const makeActorScope = (): ActorProviderRequestScope =>
  createActorProviderRequestScope({
    requestContext: {
      source: {
        platform: 'telegram',
        platformInstanceId: 'pi-1',
        chatUserId: 'user-1',
        nativeContextId: 'chat-1',
        storageContextId: 'pi-1:chat-1',
        configContextId: 'pi-1:chat-1',
        contextType: 'dm',
        actorRole: 'member',
        taskInstanceId: null,
        taskProvider: 'none',
        invocationMode: 'proactive',
        rawTurnId: null,
      },
      sourceEventId: 'proactive:test',
    },
    observeProviderRequest: () => {},
  })

// Spread-laundering keeps the declared type while injecting runtime-malformed
// fields, so fail-closed paths can be exercised without unsafe assertions.
const malformedScope = (overrides: object): ProviderRequestScope => ({ ...NO_ANALYTICS_SCOPE, ...overrides })

beforeEach(() => {
  mockLogger()
})

describe('enrichTasks', () => {
  test('returns full details for all tasks', async () => {
    const provider = createMockProvider({
      getTask: mock((taskId: string) =>
        Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}`, assignee: 'alice' }),
      ),
    })

    const result = await enrichTasks(provider, lightTasks, NO_ANALYTICS_SCOPE)
    expect(result).toHaveLength(2)
    expect(result[0]!.assignee).toBe('alice')
  })

  test('rejects when any getTask call fails', async () => {
    const provider = createMockProvider({
      getTask: mock(createFailingGetTask('task-2')),
    })

    await expect(enrichTasks(provider, lightTasks, NO_ANALYTICS_SCOPE)).rejects.toThrow('getTask boom')
  })

  test('runs every getTask inside the provided scope lease', async () => {
    const scope = makeActorScope()
    const seen: unknown[] = []
    const provider = createMockProvider({
      getTask: mock((taskId: string) => {
        seen.push(requireProviderRequestScope())
        return Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` })
      }),
    })

    await enrichTasks(provider, lightTasks, scope)

    expect(seen).toHaveLength(2)
    for (const active of seen) expect(active).toBe(scope)
  })

  test('fails before any provider method runs when the scope is malformed', async () => {
    const getTask = mock((taskId: string) =>
      Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` }),
    )
    const provider = createMockProvider({ getTask })

    await expect(enrichTasks(provider, lightTasks, malformedScope({ kind: 'bogus' }))).rejects.toThrow(
      ProviderScopeMissingError,
    )
    expect(getTask).not.toHaveBeenCalled()
  })
})

describe('fetchAllTasks', () => {
  test('fetches across projects inside the provided scope lease', async () => {
    const scope = makeActorScope()
    const seen: unknown[] = []
    const provider = createMockProvider({
      listProjects: mock(() => {
        seen.push(requireProviderRequestScope())
        return Promise.resolve([{ id: 'p1', name: 'P1', url: 'http://test/p1' }])
      }),
      listTasks: mock((projectId: string) => {
        seen.push(requireProviderRequestScope())
        return Promise.resolve([{ id: 't-1', title: 'T', url: 'http://test/t-1', projectId }])
      }),
    })

    const tasks = await fetchAllTasks(provider, scope)

    expect(tasks).toHaveLength(1)
    expect(seen).toHaveLength(2)
    for (const active of seen) expect(active).toBe(scope)
  })

  test('fails before any provider method runs when the scope is malformed', async () => {
    const listProjects = mock(() => Promise.resolve([]))
    const searchTasks = mock(() => Promise.resolve([]))
    const provider = createMockProvider({ listProjects, searchTasks })

    await expect(fetchAllTasks(provider, malformedScope({ kind: 'bogus' }))).rejects.toThrow(ProviderScopeMissingError)
    expect(listProjects).not.toHaveBeenCalled()
    expect(searchTasks).not.toHaveBeenCalled()
  })
})
