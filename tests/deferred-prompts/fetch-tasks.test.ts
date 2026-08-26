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
import { ProviderClassifiedError, providerError, type ProviderError } from '../../src/providers/errors.js'
import type { Task, TaskProvider } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/logger-mock.js'
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

/** getTask mock that rejects with a classified provider error for configured ids —
 *  module scope for the same no-conditional-in-test reason. */
const createClassifiedFailingGetTask =
  (failures: Record<string, ProviderError>) =>
  (taskId: string): Promise<Task> =>
    Object.hasOwn(failures, taskId)
      ? Promise.reject(new ProviderClassifiedError(`classified failure for ${taskId}`, failures[taskId]!))
      : Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` })

/** getTask mock whose promises stay pending until released, tracking in-flight
 *  count — module scope for the same no-conditional-in-test reason. */
type ConcurrencyTracker = { inFlight: number; maxInFlight: number; release: Array<() => void> }
const createGatedGetTask =
  (tracker: ConcurrencyTracker) =>
  (taskId: string): Promise<Task> =>
    new Promise((resolve) => {
      tracker.inFlight += 1
      tracker.maxInFlight = Math.max(tracker.maxInFlight, tracker.inFlight)
      tracker.release.push(() => {
        tracker.inFlight -= 1
        resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` })
      })
    })

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

type FetchWatchedTasksModule = {
  fetchWatchedTasks: (provider: TaskProvider, ids: string[], scope: ProviderRequestScope) => Promise<Task[]>
}

describe('fetchWatchedTasks', () => {
  const tracked: TrackedLoggerMock = createTrackedLoggerMock()

  // fetch-tasks.ts binds its child logger at module load, so each test installs
  // the tracked logger and imports the module through a cachebuster query to get
  // a fresh binding (pattern from tool-handlers-logging.test.ts). The export is
  // implemented in plan step 3.2; until then the Reflect.get guard throws and
  // these tests stay RED without breaking typecheck/lint.
  const importFetchTasksFresh = (): Promise<typeof import('../../src/deferred-prompts/fetch-tasks.js')> =>
    import(`../../src/deferred-prompts/fetch-tasks.js?test=${crypto.randomUUID()}`)

  const resolveWatchedFetch = (mod: object): FetchWatchedTasksModule => {
    const candidate: { fetchWatchedTasks?: unknown } = {
      fetchWatchedTasks: Reflect.get(mod, 'fetchWatchedTasks'),
    }
    const hasWatchedFetch = (value: typeof candidate): value is FetchWatchedTasksModule =>
      typeof value.fetchWatchedTasks === 'function'
    if (!hasWatchedFetch(candidate)) {
      throw new Error('fetchWatchedTasks export missing (implemented in plan step 3.2)')
    }
    return candidate
  }

  const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `t-${i + 1}`)

  beforeEach(() => {
    tracked.clearCalls()
    void mock.module('../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
  })

  test('fetches each watched task by id via getTask', async () => {
    const { fetchWatchedTasks } = resolveWatchedFetch(await importFetchTasksFresh())
    const getTask = mock((taskId: string) =>
      Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` }),
    )
    const provider = createMockProvider({ getTask })

    const result = await fetchWatchedTasks(provider, ['t-1', 't-2'], NO_ANALYTICS_SCOPE)

    expect(getTask).toHaveBeenCalledTimes(2)
    expect(getTask).toHaveBeenCalledWith('t-1')
    expect(getTask).toHaveBeenCalledWith('t-2')
    expect(result.map((t) => t.id)).toEqual(['t-1', 't-2'])
  })

  test('bounds getTask concurrency: no more than 4 in flight', async () => {
    const { fetchWatchedTasks } = resolveWatchedFetch(await importFetchTasksFresh())
    const tracker: ConcurrencyTracker = { inFlight: 0, maxInFlight: 0, release: [] }
    const provider = createMockProvider({ getTask: mock(createGatedGetTask(tracker)) })
    const watched = ids(8)

    const pending = fetchWatchedTasks(provider, watched, NO_ANALYTICS_SCOPE)
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(tracker.maxInFlight).toBe(4)
    for (const release of tracker.release) release()
    const result = await pending
    expect(result.map((t) => t.id)).toEqual(watched)
  })

  test('skips ids failing as not-found under both provider codes, keeps the rest', async () => {
    const { fetchWatchedTasks } = resolveWatchedFetch(await importFetchTasksFresh())
    const provider = createMockProvider({
      getTask: mock(
        createClassifiedFailingGetTask({
          't-gone': providerError.taskNotFound('t-gone'),
          't-other': providerError.notFound('task', 't-other'),
        }),
      ),
    })

    const result = await fetchWatchedTasks(provider, ['t-1', 't-gone', 't-other', 't-4'], NO_ANALYTICS_SCOPE)

    expect(result.map((t) => t.id)).toEqual(['t-1', 't-4'])
  })

  test('warns with the skipped id when a watched task is not found', async () => {
    const { fetchWatchedTasks } = resolveWatchedFetch(await importFetchTasksFresh())
    const provider = createMockProvider({
      getTask: mock(createClassifiedFailingGetTask({ 't-gone': providerError.taskNotFound('t-gone') })),
    })

    const result = await fetchWatchedTasks(provider, ['t-1', 't-gone'], NO_ANALYTICS_SCOPE)

    expect(result.map((t) => t.id)).toEqual(['t-1'])
    const warnDump = JSON.stringify(tracked.getCallsByLevel('warn').map((c) => c.args))
    expect(warnDump).toContain('t-gone')
  })

  test('rejects on any other classified error', async () => {
    const { fetchWatchedTasks } = resolveWatchedFetch(await importFetchTasksFresh())
    const provider = createMockProvider({
      getTask: mock(() => Promise.reject(new ProviderClassifiedError('denied', providerError.accessDenied('task')))),
    })

    await expect(fetchWatchedTasks(provider, ['t-1'], NO_ANALYTICS_SCOPE)).rejects.toThrow('denied')
  })

  test('rejects on a plain error', async () => {
    const { fetchWatchedTasks } = resolveWatchedFetch(await importFetchTasksFresh())
    const provider = createMockProvider({ getTask: mock(createFailingGetTask('t-1')) })

    await expect(fetchWatchedTasks(provider, ['t-1', 't-2'], NO_ANALYTICS_SCOPE)).rejects.toThrow('getTask boom')
  })

  test('runs every getTask inside the provided scope lease', async () => {
    const { fetchWatchedTasks } = resolveWatchedFetch(await importFetchTasksFresh())
    const scope = makeActorScope()
    const seen: unknown[] = []
    const provider = createMockProvider({
      getTask: mock((taskId: string) => {
        seen.push(requireProviderRequestScope())
        return Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` })
      }),
    })

    await fetchWatchedTasks(provider, ['t-1', 't-2'], scope)

    expect(seen).toHaveLength(2)
    for (const active of seen) expect(active).toBe(scope)
  })

  test('fails before any provider method runs when the scope is malformed', async () => {
    const { fetchWatchedTasks } = resolveWatchedFetch(await importFetchTasksFresh())
    const getTask = mock((taskId: string) =>
      Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` }),
    )
    const provider = createMockProvider({ getTask })

    await expect(fetchWatchedTasks(provider, ['t-1'], malformedScope({ kind: 'bogus' }))).rejects.toThrow(
      ProviderScopeMissingError,
    )
    expect(getTask).not.toHaveBeenCalled()
  })
})
