import { Database } from 'bun:sqlite'
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import assert from 'node:assert/strict'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import { setCachedConfig } from '../src/cache.js'
import type { ChatProvider } from '../src/chat/types.js'
import * as schema from '../src/db/schema.js'
import type { TaskCapability, Task, TaskProvider } from '../src/providers/types.js'
import { createRecurringTask, getDueRecurringTasks } from '../src/recurring.js'
import type { SchedulerDeps } from '../src/scheduler.js'
import { tick, createMissedTasks, startScheduler, stopScheduler } from '../src/scheduler.js'
import { setKaneoWorkspace } from '../src/users.js'
import { createMockProvider } from './tools/mock-provider.js'
import { clearUserCache } from './utils/test-cache.js'
import { createMockChatWithHandler, mockLogger, setTestDrizzleDb } from './utils/test-helpers.js'

process.env['TASK_PROVIDER'] = 'kaneo'
process.env['KANEO_CLIENT_URL'] = 'http://localhost:11337'

const USER_ID = 'user-1'

describe('scheduler', () => {
  // ---- Mutable mock state ----

  type MockTask = { id: string; title: string; projectId: string; status: string; priority: string; url: string }

  let createTaskImpl: (...args: unknown[]) => Promise<MockTask>
  let addTaskLabelImpl: (taskId: string, labelId: string) => Promise<{ taskId: string; labelId: string }>
  let mockCapabilities: Set<TaskCapability>
  let schedulerDeps: SchedulerDeps

  let resolveCreateTask: (() => void) | null
  let createTaskCallCount: number

  // ---- Chat provider mock for notifications ----

  let sendMessageCalls: Array<{ userId: string; text: string }>
  let sendMessageImpl: (userId: string, text: string) => Promise<void>

  let mockChatProvider: ChatProvider

  // ---- In-memory test database ----

  let testSqlite: Database
  let testDb: ReturnType<typeof drizzle<typeof schema>>

  const defaultCreateTask = (): Promise<MockTask> =>
    Promise.resolve({
      id: 'new-task-1',
      title: 'Recurring Test',
      projectId: 'proj-1',
      status: 'todo',
      priority: 'medium',
      url: 'https://test.com/task/new-task-1',
    })

  const setupDb = (): void => {
    testSqlite = new Database(':memory:')
    testSqlite.run('PRAGMA foreign_keys=ON')
    testDb = drizzle(testSqlite, { schema })
    testSqlite.run(`
      CREATE TABLE IF NOT EXISTS users (
        platform_user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT DEFAULT (datetime('now')) NOT NULL,
        added_by TEXT NOT NULL,
        kaneo_workspace_id TEXT
      )
    `)
    testSqlite.run(`
      CREATE TABLE IF NOT EXISTS recurring_tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE, project_id TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, priority TEXT, status TEXT, assignee TEXT, labels TEXT,
        trigger_type TEXT NOT NULL DEFAULT 'cron', rrule TEXT, dtstart_utc TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC', enabled TEXT NOT NULL DEFAULT '1',
        catch_up TEXT NOT NULL DEFAULT '0', last_run TEXT, next_run TEXT,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL, updated_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
    testSqlite.run('CREATE INDEX IF NOT EXISTS idx_recurring_tasks_user ON recurring_tasks(user_id)')
    testSqlite.run('CREATE INDEX IF NOT EXISTS idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')
    testSqlite.run(`
      CREATE TABLE IF NOT EXISTS recurring_task_occurrences (
        id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE, task_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
  }

  const seedUser = (userId: string = USER_ID): void => {
    testSqlite.run('INSERT OR IGNORE INTO users (platform_user_id, added_by) VALUES (?, ?)', [userId, 'admin'])
    clearUserCache(userId)
    setCachedConfig(userId, 'kaneo_apikey', 'test-api-key')
    setKaneoWorkspace(userId, 'workspace-1')
  }

  const createDueTask = (
    overrides: Partial<{
      userId: string
      projectId: string
      title: string
      labels: string[]
      priority: string
      status: string
    }> = {},
  ): string => {
    const record = createRecurringTask({
      userId: overrides.userId ?? USER_ID,
      projectId: overrides.projectId ?? 'proj-1',
      title: overrides.title ?? 'Recurring Test',
      triggerType: 'cron',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
      catchUp: false,
      labels: overrides.labels,
      priority: overrides.priority,
      status: overrides.status,
    })
    testSqlite.run(`UPDATE recurring_tasks SET next_run = datetime('now', '-1 minute') WHERE id = '${record.id}'`)
    return record.id
  }

  /**
   * Call tick() and wait for it to fully complete, including the finally block.
   */
  const awaitTick = async (): Promise<void> => {
    await tick(schedulerDeps)
  }

  beforeEach(() => {
    // Reset mutable state to defaults
    createTaskCallCount = 0
    resolveCreateTask = null
    createTaskImpl = defaultCreateTask
    addTaskLabelImpl = (taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> =>
      Promise.resolve({ taskId, labelId })
    mockCapabilities = new Set<TaskCapability>()
    sendMessageCalls = []
    sendMessageImpl = (): Promise<void> => Promise.resolve()

    // Register mocks
    mockLogger()

    schedulerDeps = {
      createProvider: (_name: string, _config: Record<string, string>): TaskProvider =>
        createMockProvider({
          capabilities: mockCapabilities,
          createTask: (params): Promise<Task> => {
            createTaskCallCount++
            return createTaskImpl(params)
          },
          addTaskLabel: (taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> =>
            addTaskLabelImpl(taskId, labelId),
        }),
    }

    // Build mockChatProvider (uses mutable sendMessageImpl/sendMessageCalls)
    const { mockChat } = createMockChatWithHandler((userId: string, text: string): Promise<void> => {
      sendMessageCalls.push({ userId, text })
      return sendMessageImpl(userId, text)
    })
    mockChatProvider = mockChat

    setupDb()
    setTestDrizzleDb(testDb)
    seedUser()
  })

  afterEach(() => {
    stopScheduler()
  })

  describe('scheduler tick in-flight guard', () => {
    test('second concurrent tick is skipped while first is still running', async () => {
      createDueTask()

      createTaskImpl = (): Promise<MockTask> =>
        new Promise<MockTask>((resolve) => {
          resolveCreateTask = (): void =>
            resolve({
              id: 'new-task-1',
              title: 'Test',
              projectId: 'p1',
              status: 'todo',
              priority: 'medium',
              url: 'https://test.com/task/new-task-1',
            })
        })

      const firstTick = tick(schedulerDeps)
      const secondTick = tick(schedulerDeps)

      await Promise.resolve()
      await Promise.resolve()

      assert(resolveCreateTask !== null, 'resolveCreateTask should be set by now')
      resolveCreateTask()

      await firstTick
      await secondTick

      expect(createTaskCallCount).toBe(1)
    })
  })

  describe('tick() — happy path', () => {
    test('tick() with one due task creates task instance', async () => {
      createDueTask()
      await awaitTick()
      expect(createTaskCallCount).toBe(1)
    })

    test('tick() marks task as executed after creation', async () => {
      const taskId = createDueTask()
      await awaitTick()
      const row = testSqlite
        .query<{ last_run: string | null; next_run: string | null }, []>(
          `SELECT last_run, next_run FROM recurring_tasks WHERE id = '${taskId}'`,
        )
        .get()
      expect(row).toBeDefined()
      expect(row!.last_run).not.toBeNull()
      expect(new Date(row!.next_run!).getTime()).toBeGreaterThan(new Date(row!.last_run!).getTime())
    })

    test('tick() records occurrence linking template to created task', async () => {
      createDueTask()
      await awaitTick()
      const occurrences = testSqlite
        .query<{ template_id: string; task_id: string }, []>(
          'SELECT template_id, task_id FROM recurring_task_occurrences',
        )
        .all()
      expect(occurrences).toHaveLength(1)
      expect(occurrences[0]!.task_id).toBe('new-task-1')
    })

    test('tick() with no due tasks makes no provider calls', () => {
      createRecurringTask({
        userId: USER_ID,
        projectId: 'proj-1',
        title: 'Future Task',
        triggerType: 'cron',
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
        catchUp: false,
      })
      const dueTasks = getDueRecurringTasks()
      expect(dueTasks).toHaveLength(0)
      expect(createTaskCallCount).toBe(0)
    })
  })

  describe('tick() — error resilience', () => {
    test('tick() when provider createTask throws does not crash, task NOT marked executed', async () => {
      const taskId = createDueTask()
      createTaskImpl = (): Promise<MockTask> => Promise.reject(new Error('API down'))
      await awaitTick()
      const row = testSqlite
        .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE id = '${taskId}'`)
        .get()
      expect(row!.last_run).toBeNull()
    })

    test('tick() continues processing remaining tasks after one fails', async () => {
      const taskId1 = createDueTask({ title: 'Task 1' })
      const USER_2 = 'user-2'
      seedUser(USER_2)
      const taskId2 = createDueTask({ userId: USER_2, title: 'Task 2' })

      const responses: Array<() => Promise<MockTask>> = [
        () => Promise.reject(new Error('API down')),
        () =>
          Promise.resolve({
            id: 'new-task-2',
            title: 'Task 2',
            projectId: 'proj-1',
            status: 'todo',
            priority: 'medium',
            url: 'https://test.com/task/new-task-2',
          }),
      ]
      createTaskImpl = (): Promise<MockTask> => responses.shift()!()

      await awaitTick()

      const row1 = testSqlite
        .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE id = '${taskId1}'`)
        .get()
      expect(row1!.last_run).toBeNull()

      const row2 = testSqlite
        .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE id = '${taskId2}'`)
        .get()
      expect(row2!.last_run).not.toBeNull()

      const occurrences = testSqlite.query<{ id: string }, []>('SELECT id FROM recurring_task_occurrences').all()
      expect(occurrences).toHaveLength(1)
    })
  })

  describe('tick() — label application', () => {
    test('tick() applies labels when provider supports labels.assign', async () => {
      mockCapabilities = new Set<TaskCapability>(['labels.assign'])
      const addTaskLabelCalls: Array<{ taskId: string; labelId: string }> = []
      addTaskLabelImpl = (taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> => {
        addTaskLabelCalls.push({ taskId, labelId })
        return Promise.resolve({ taskId, labelId })
      }
      createDueTask({ labels: ['label-1', 'label-2'] })
      await awaitTick()
      expect(addTaskLabelCalls).toHaveLength(2)
      expect(addTaskLabelCalls[0]!.labelId).toBe('label-1')
      expect(addTaskLabelCalls[1]!.labelId).toBe('label-2')
    })

    test('tick() skips label application when provider lacks labels.assign', async () => {
      const addTaskLabelCalls: Array<{ taskId: string; labelId: string }> = []
      addTaskLabelImpl = (taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> => {
        addTaskLabelCalls.push({ taskId, labelId })
        return Promise.resolve({ taskId, labelId })
      }
      createDueTask({ labels: ['label-1', 'label-2'] })
      await awaitTick()
      expect(addTaskLabelCalls).toHaveLength(0)
    })
  })

  describe('tick() — user notification', () => {
    test('tick() notifies user after task creation', async () => {
      createDueTask()
      startScheduler(mockChatProvider, schedulerDeps)
      // startScheduler calls tick() immediately, which processes the due task
      await Bun.sleep(50)
      expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1)
      expect(sendMessageCalls[0]!.userId).toBe(USER_ID)
      expect(sendMessageCalls[0]!.text).toContain('Recurring Test')
    })

    test('tick() continues when notifyUser throws', async () => {
      sendMessageImpl = (): Promise<void> => Promise.reject(new Error('notification failed'))
      const taskId = createDueTask()
      startScheduler(mockChatProvider, schedulerDeps)
      await Bun.sleep(50)
      const row = testSqlite
        .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE id = '${taskId}'`)
        .get()
      expect(row!.last_run).not.toBeNull()
    })
  })

  describe('tick() — provider build failure', () => {
    test('tick() when buildProviderForUser returns null skips the task', async () => {
      clearUserCache(USER_ID)
      createDueTask()
      await awaitTick()
      expect(createTaskCallCount).toBe(0)
      const row = testSqlite
        .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE user_id = '${USER_ID}'`)
        .get()
      expect(row!.last_run).toBeNull()
    })
  })

  describe('createMissedTasks', () => {
    test('createMissedTasks with 3 missed dates creates 3 tasks', async () => {
      const taskId = createDueTask()
      const result = await createMissedTasks(taskId, ['2026-03-02', '2026-03-09', '2026-03-16'], schedulerDeps)
      expect(result).toBe(3)
      expect(createTaskCallCount).toBe(3)
      const occurrences = testSqlite.query<{ id: string }, []>('SELECT id FROM recurring_task_occurrences').all()
      expect(occurrences).toHaveLength(3)
    })

    test('createMissedTasks where one creation fails returns partial count', async () => {
      const taskId = createDueTask()
      const responses: Array<() => Promise<MockTask>> = [
        () =>
          Promise.resolve({
            id: 'new-task-1',
            title: 'Missed',
            projectId: 'proj-1',
            status: 'todo',
            priority: 'medium',
            url: 'https://test.com/task/new-task-1',
          }),
        () => Promise.reject(new Error('API down')),
        () =>
          Promise.resolve({
            id: 'new-task-3',
            title: 'Missed',
            projectId: 'proj-1',
            status: 'todo',
            priority: 'medium',
            url: 'https://test.com/task/new-task-3',
          }),
      ]
      createTaskImpl = (): Promise<MockTask> => responses.shift()!()
      const result = await createMissedTasks(taskId, ['2026-03-02', '2026-03-09', '2026-03-16'], schedulerDeps)
      expect(result).toBe(2)
    })

    test('createMissedTasks with empty missedDates returns 0', async () => {
      const taskId = createDueTask()
      const result = await createMissedTasks(taskId, [], schedulerDeps)
      expect(result).toBe(0)
      expect(createTaskCallCount).toBe(0)
    })

    test('createMissedTasks with non-existent recurring task ID returns 0', async () => {
      const result = await createMissedTasks('non-existent-id', ['2026-03-02'], schedulerDeps)
      expect(result).toBe(0)
      expect(createTaskCallCount).toBe(0)
    })
  })

  describe('startScheduler / stopScheduler', () => {
    test('startScheduler double-call does not error', () => {
      startScheduler(mockChatProvider, schedulerDeps)
      expect(() => startScheduler(mockChatProvider, schedulerDeps)).not.toThrow()
    })

    test('stopScheduler clears state and disables notifications', async () => {
      startScheduler(mockChatProvider, schedulerDeps)
      stopScheduler()
      createDueTask()
      await awaitTick()
      expect(sendMessageCalls).toHaveLength(0)
    })
  })
})
