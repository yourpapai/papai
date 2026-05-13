import { mock, beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import type { ChatProvider, DeferredDeliveryTarget } from '../../src/chat/types.js'
import { setConfig } from '../../src/config.js'
import { createAlertPrompt, getAlertPrompt } from '../../src/deferred-prompts/alerts.js'
import { pollAlertsOnce, pollScheduledOnce } from '../../src/deferred-prompts/poller.js'
import { createScheduledPrompt, getScheduledPrompt } from '../../src/deferred-prompts/scheduled.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { createMockChatWithSentMessages, mockLogger, setupTestDb } from '../utils/test-helpers.js'

function setupUserConfig(userId: string): void {
  setConfig(userId, 'llm_apikey', 'test-key')
  setConfig(userId, 'llm_baseurl', 'http://localhost:11434/v1')
  setConfig(userId, 'main_model', 'test-model')
  setConfig(userId, 'timezone', 'UTC')
}

const USER_ID = 'poller-user-1'

beforeEach(() => {
  mockLogger()
})

// Mock AI module using mutable implementation pattern
type GenerateTextResult = {
  text: string
  toolCalls: unknown[]
  toolResults: unknown[]
  response: { messages: ModelMessage[] }
}

// --- Tests ---

describe('pollScheduledOnce', () => {
  let sentMessages: Array<{ target: { contextId: string; contextType: string }; text: string }>
  let chat: ChatProvider
  let provider: TaskProvider
  let generateTextImpl = (): Promise<GenerateTextResult> =>
    Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })

  beforeEach(async () => {
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: 'Task completed.', toolCalls: [], toolResults: [], response: { messages: [] } })
    void mock.module('ai', () => ({
      generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
      stepCountIs: (_n: number): unknown => undefined,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): (() => string) => (): string => 'mock-model',
    }))
    await setupTestDb()
    const result = createMockChatWithSentMessages()
    chat = result.provider
    sentMessages = result.sentMessages
    provider = createMockProvider()
    setupUserConfig(USER_ID)
  })

  test('executes a due one-shot prompt, marks completed, sends message', async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Check my overdue tasks', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => provider)

    // Should have sent a message
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.target.contextId).toBe(USER_ID)
    expect(sentMessages[0]!.text).toBe('Task completed.')

    // Should be marked as completed
    const updated = getScheduledPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('completed')
    expect(updated!.lastExecutedAt).not.toBeNull()
  })

  test('does not execute future prompts', async () => {
    const futureTime = new Date(Date.now() + 3_600_000).toISOString()
    createScheduledPrompt(USER_ID, 'Future task', { fireAt: futureTime })

    await pollScheduledOnce(chat, () => provider)

    expect(sentMessages).toHaveLength(0)
  })

  test('advances recurring prompt to next cron occurrence', async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Daily standup', {
      fireAt: pastTime,
      cronCompiled: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', dtstartUtc: pastTime },
    })

    await pollScheduledOnce(chat, () => provider)

    // Should have sent a message
    expect(sentMessages).toHaveLength(1)

    // Should still be active with updated fireAt
    const updated = getScheduledPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('active')
    expect(updated!.lastExecutedAt).not.toBeNull()
    // fireAt should be in the future (next occurrence)
    expect(new Date(updated!.fireAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('merges multiple due prompts for the same user into one LLM call', async () => {
    let callCount = 0
    generateTextImpl = (): Promise<GenerateTextResult> => {
      callCount++
      return Promise.resolve({
        text: 'All tasks handled.',
        toolCalls: [],
        toolResults: [],
        response: { messages: [] },
      })
    }

    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const p1 = createScheduledPrompt(USER_ID, 'Check overdue tasks', { fireAt: pastTime })
    const p2 = createScheduledPrompt(USER_ID, 'Send daily report', { fireAt: pastTime })
    const p3 = createScheduledPrompt(USER_ID, 'Review pull requests', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => provider)

    // Single LLM call for all three prompts
    expect(callCount).toBe(1)
    // Single message sent to user
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.text).toBe('All tasks handled.')

    // All three should be completed
    expect(getScheduledPrompt(p1.id, USER_ID)!.status).toBe('completed')
    expect(getScheduledPrompt(p2.id, USER_ID)!.status).toBe('completed')
    expect(getScheduledPrompt(p3.id, USER_ID)!.status).toBe('completed')
  })

  test('merges mixed one-shot and recurring prompts for same user', async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const oneShot = createScheduledPrompt(USER_ID, 'One-time reminder', { fireAt: pastTime })
    const recurring = createScheduledPrompt(USER_ID, 'Daily standup', {
      fireAt: pastTime,
      cronCompiled: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', dtstartUtc: pastTime },
    })

    await pollScheduledOnce(chat, () => provider)

    expect(sentMessages).toHaveLength(1)
    expect(getScheduledPrompt(oneShot.id, USER_ID)!.status).toBe('completed')
    const updatedRecurring = getScheduledPrompt(recurring.id, USER_ID)!
    expect(updatedRecurring.status).toBe('active')
    expect(new Date(updatedRecurring.fireAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('different users get separate LLM calls', async () => {
    let callCount = 0
    generateTextImpl = (): Promise<GenerateTextResult> => {
      callCount++
      return Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })
    }

    const otherUser = 'poller-user-2'
    setupUserConfig(otherUser)

    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'Task A', { fireAt: pastTime })
    createScheduledPrompt(USER_ID, 'Task B', { fireAt: pastTime })
    createScheduledPrompt(otherUser, 'Task C', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => provider)

    // Two LLM calls: one per user
    expect(callCount).toBe(2)
    // Two messages: one per user
    expect(sentMessages).toHaveLength(2)
  })

  test('skips prompt when LLM config is missing', async () => {
    // Create a user without LLM config
    const unconfiguredUser = 'unconfigured-user'
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(unconfiguredUser, 'No config', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => provider)

    // Should still send the fallback message
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.text).toContain('missing LLM configuration')
  })
})

describe('pollScheduledOnce — error handling', () => {
  let sentMessages: Array<{ target: { contextId: string; contextType: string }; text: string }>
  let chat: ChatProvider
  let generateTextImpl = (): Promise<GenerateTextResult> =>
    Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })

  beforeEach(async () => {
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: 'Task completed.', toolCalls: [], toolResults: [], response: { messages: [] } })
    void mock.module('ai', () => ({
      generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
      stepCountIs: (_n: number): unknown => undefined,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): (() => string) => (): string => 'mock-model',
    }))
    await setupTestDb()
    const result = createMockChatWithSentMessages()
    chat = result.provider
    sentMessages = result.sentMessages
    setupUserConfig(USER_ID)
  })

  test('notifies user when LLM throws', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM down'))
    const userId = 'fail-user'
    setupUserConfig(userId)
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(userId, 'do something', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => createMockProvider())

    expect(sentMessages.some((m) => m.target.contextId === userId)).toBe(true)
  })

  test('completes one-shot prompt even when LLM fails', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM down'))
    const userId = 'fail-complete-user'
    setupUserConfig(userId)
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(userId, 'one-time task', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => createMockProvider())

    const updated = getScheduledPrompt(created.id, userId)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('completed')
  })

  test('advances recurring prompt even when LLM fails', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM down'))
    const userId = 'fail-recurring-user'
    setupUserConfig(userId)
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(userId, 'daily standup', {
      fireAt: pastTime,
      cronCompiled: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', dtstartUtc: pastTime },
    })

    await pollScheduledOnce(chat, () => createMockProvider())

    const updated = getScheduledPrompt(created.id, userId)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('active')
    expect(new Date(updated!.fireAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('keeps one-shot prompt active when delivery fails after LLM succeeds', async () => {
    const userId = 'delivery-fail-user'
    setupUserConfig(userId)
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(userId, 'one-time task', { fireAt: pastTime })

    const failOnceThenRecord = mock((_target: DeferredDeliveryTarget, text: string): Promise<void> => {
      sentMessages.push({ target: _target, text })
      return Promise.resolve()
    })
    failOnceThenRecord.mockImplementationOnce(() => Promise.reject(new Error('delivery failed')))
    chat = { ...chat, sendMessage: failOnceThenRecord }

    await pollScheduledOnce(chat, () => createMockProvider())

    const updated = getScheduledPrompt(created.id, userId)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('active')
    expect(updated!.lastExecutedAt).toBeNull()
    expect(sentMessages).toHaveLength(0)
  })
})

describe('pollAlertsOnce', () => {
  let sentMessages: Array<{ target: { contextId: string; contextType: string }; text: string }>
  let chat: ChatProvider
  let generateTextImpl = (): Promise<GenerateTextResult> =>
    Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })

  beforeEach(async () => {
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: 'Alert triggered.', toolCalls: [], toolResults: [], response: { messages: [] } })
    void mock.module('ai', () => ({
      generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
      tool: (opts: unknown): unknown => opts,
      stepCountIs: (_n: number): unknown => undefined,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): (() => string) => (): string => 'mock-model',
    }))
    await setupTestDb()
    const result = createMockChatWithSentMessages()
    chat = result.provider
    sentMessages = result.sentMessages
    setupUserConfig(USER_ID)
  })

  test('does not trigger when no alerts exist', async () => {
    const provider = createMockProvider()

    await pollAlertsOnce(chat, () => provider)

    expect(sentMessages).toHaveLength(0)
  })

  test('does not trigger when no tasks match condition', async () => {
    createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' })

    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Test', status: 'in-progress', url: 'http://test/1' }]),
      ),
    })

    await pollAlertsOnce(chat, () => provider)

    expect(sentMessages).toHaveLength(0)
  })

  test('triggers alert when task matches condition', async () => {
    createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' })

    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Completed Task', status: 'done', url: 'http://test/1' }]),
      ),
    })

    await pollAlertsOnce(chat, () => provider)

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.target.contextId).toBe(USER_ID)
    expect(sentMessages[0]!.text).toBe('Alert triggered.')
  })

  test('enriches tasks via getTask when condition references assignee', async () => {
    createAlertPrompt(USER_ID, 'Notify on alice assignment', {
      field: 'task.assignee',
      op: 'eq',
      value: 'alice',
    })

    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Assigned Task', status: 'todo', url: 'http://test/1' }]),
      ),
      getTask: mock(() =>
        Promise.resolve({
          id: 'task-1',
          title: 'Assigned Task',
          status: 'todo',
          assignee: 'alice',
          url: 'http://test/1',
        }),
      ),
    })

    await pollAlertsOnce(chat, () => provider)

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.text).toBe('Alert triggered.')
  })

  test('does not update alert trigger time when delivery fails', async () => {
    const created = createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' })
    const failOnceThenRecord = mock((_target: DeferredDeliveryTarget, text: string): Promise<void> => {
      sentMessages.push({ target: _target, text })
      return Promise.resolve()
    })
    failOnceThenRecord.mockImplementationOnce(() => Promise.reject(new Error('delivery failed')))
    chat = { ...chat, sendMessage: failOnceThenRecord }

    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Completed Task', status: 'done', url: 'http://test/1' }]),
      ),
    })

    await pollAlertsOnce(chat, () => provider)

    const updated = getAlertPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.lastTriggeredAt).toBeNull()
    expect(sentMessages).toHaveLength(0)
  })
})

describe('pollScheduledOnce Race Condition', () => {
  let sentMessages: Array<{ target: { contextId: string; contextType: string }; text: string }>
  let chat: ChatProvider
  let provider: TaskProvider
  let resolveLlm: (result: GenerateTextResult) => void
  let llmPromise: Promise<GenerateTextResult>

  beforeEach(async () => {
    llmPromise = new Promise((resolve) => {
      resolveLlm = resolve
    })

    void mock.module('ai', () => ({
      generateText: (): Promise<GenerateTextResult> => llmPromise,
      stepCountIs: (): unknown => undefined,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): (() => string) => (): string => 'mock-model',
    }))

    await setupTestDb()
    const result = createMockChatWithSentMessages()
    chat = result.provider
    sentMessages = result.sentMessages
    provider = createMockProvider()
    setupUserConfig(USER_ID)
  })

  test('bug reproduction: overlapping polls cause multiple executions', async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'Slow task', { fireAt: pastTime })

    // Start first poll (will hang on llmPromise)
    const poll1 = pollScheduledOnce(chat, () => provider)

    // Wait a bit to ensure it's in-flight but not too much to trigger timeout
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })

    // Second poll immediately - it will see the same prompt as 'active' and 'due'
    // because poll1 hasn't updated its status yet
    const poll2 = pollScheduledOnce(chat, () => provider)

    // Wait a bit more
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })

    // Resolve LLM
    resolveLlm({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })

    await Promise.all([poll1, poll2])

    // With the fix, only one message should be sent even with overlapping polls
    expect(sentMessages).toHaveLength(1)
  })
})

describe('delivery target routing', () => {
  let sentMessages: Array<{ target: DeferredDeliveryTarget; text: string }>
  let chat: ChatProvider
  let provider: TaskProvider
  let generateTextImpl = (): Promise<GenerateTextResult> =>
    Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })

  beforeEach(async () => {
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })
    void mock.module('ai', () => ({
      generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
      stepCountIs: (_n: number): unknown => undefined,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): (() => string) => (): string => 'mock-model',
    }))
    await setupTestDb()
    const result = createMockChatWithSentMessages()
    chat = result.provider
    sentMessages = result.sentMessages
    provider = createMockProvider()
    setupUserConfig(USER_ID)
  })

  test('scheduled prompt created in group fires to stored group target, not DM', async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'Check my overdue tasks', { fireAt: pastTime }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'personal',
      mentionUserIds: [USER_ID],
      createdByUserId: USER_ID,
      createdByUsername: null,
    })

    await pollScheduledOnce(chat, () => provider)

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.target.contextId).toBe('-1001')
    expect(sentMessages[0]!.target.threadId).toBe('42')
    expect(sentMessages[0]!.target.audience).toBe('personal')
  })

  test('alert created in group fires to stored group target, not DM', async () => {
    createAlertPrompt(
      USER_ID,
      'Notify this channel',
      { field: 'task.status', op: 'eq', value: 'done' },
      60,
      undefined,
      {
        contextId: 'chan-1',
        contextType: 'group',
        threadId: 'root-1',
        audience: 'shared',
        mentionUserIds: [],
        createdByUserId: USER_ID,
        createdByUsername: null,
      },
    )

    const matchingProvider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Completed Task', status: 'done', url: 'http://test/1' }]),
      ),
    })

    await pollAlertsOnce(chat, () => matchingProvider)

    expect(sentMessages.length).toBeGreaterThan(0)
    expect(sentMessages[0]!.target.contextId).toBe('chan-1')
    expect(sentMessages[0]!.target.audience).toBe('shared')
  })

  test('same creator but different delivery targets do not merge into one scheduled execution batch', async () => {
    let callCount = 0
    generateTextImpl = (): Promise<GenerateTextResult> => {
      callCount++
      return Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })
    }

    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'DM task', { fireAt: pastTime })
    createScheduledPrompt(USER_ID, 'Group task', { fireAt: pastTime }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: null,
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: USER_ID,
      createdByUsername: null,
    })

    await pollScheduledOnce(chat, () => provider)

    expect(callCount).toBe(2)
  })

  test('same creator and thread but different delivery semantics do not merge into one scheduled execution batch', async () => {
    let callCount = 0
    generateTextImpl = (): Promise<GenerateTextResult> => {
      callCount++
      return Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })
    }

    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'Personal reminder', { fireAt: pastTime }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'personal',
      mentionUserIds: [USER_ID],
      createdByUserId: USER_ID,
      createdByUsername: 'alice',
    })
    createScheduledPrompt(USER_ID, 'Shared reminder', { fireAt: pastTime }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: USER_ID,
      createdByUsername: 'alice',
    })

    await pollScheduledOnce(chat, () => provider)

    expect(callCount).toBe(2)
    expect(sentMessages).toHaveLength(2)
    expect(sentMessages.map((message) => message.target.audience).sort()).toEqual(['personal', 'shared'])
  })

  test('shared scheduled prompts still batch together when one stored target has stale mention ids', async () => {
    let callCount = 0
    generateTextImpl = (): Promise<GenerateTextResult> => {
      callCount++
      return Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })
    }

    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'Shared reminder one', { fireAt: pastTime }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'shared',
      mentionUserIds: ['stale-user-id'],
      createdByUserId: USER_ID,
      createdByUsername: 'alice',
    })
    createScheduledPrompt(USER_ID, 'Shared reminder two', { fireAt: pastTime }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: USER_ID,
      createdByUsername: 'alice',
    })

    await pollScheduledOnce(chat, () => provider)

    expect(callCount).toBe(1)
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.target.audience).toBe('shared')
  })
})
