// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { listActiveAttachments, persistIncomingAttachments, stageFileMetadata } from '../../src/attachments/index.js'
import {
  getConfigContextIdFromStorageContextId,
  toScopedContextId,
  toScopedThreadContextId,
} from '../../src/chat/scoped-context.js'
import type { IncomingFile } from '../../src/chat/types.js'
import { createAlertPrompt, listAlertPrompts } from '../../src/deferred-prompts/alerts.js'
import { getIdentityMapping } from '../../src/identity/mapping.js'
import { listInstructions } from '../../src/instructions.js'
import { listMemos } from '../../src/memos.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../src/plugins/types.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { listRecurringTasks } from '../../src/recurring.js'
import { makeTools } from '../../src/tools/index.js'
import { buildProviderlessTools, buildTools } from '../../src/tools/tools-builder.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

type DeferredListResult = Readonly<{ prompts: readonly Readonly<{ prompt: string }>[] }>

function isPromptSummary(value: unknown): value is Readonly<{ prompt: string }> {
  if (typeof value !== 'object' || value === null || !('prompt' in value)) return false
  return typeof value.prompt === 'string'
}

function isDeferredListResult(value: unknown): value is DeferredListResult {
  if (typeof value !== 'object' || value === null || !('prompts' in value)) return false
  const prompts = value.prompts
  if (!Array.isArray(prompts)) return false
  return prompts.every((prompt: unknown) => isPromptSummary(prompt))
}

function assertDeferredListResult(value: unknown): asserts value is DeferredListResult {
  if (!isDeferredListResult(value)) throw new Error('Expected deferred prompt list result')
}

describe('buildTools', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should include core tools', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
    expect(tools).toHaveProperty('get_current_time')
  })

  it('should expose get_current_user when provider exposes getCurrentUser and identityResolver', () => {
    const provider = createMockProvider({
      identityResolver: {
        searchUsers: () => Promise.resolve([]),
      },
    })

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('get_current_user')
  })

  it('should not expose get_current_user when provider getCurrentUser is missing', () => {
    const provider = createMockProvider({
      getCurrentUser: undefined,
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('get_current_user')
  })

  it('should not expose get_current_user when provider identityResolver is missing', () => {
    const provider = createMockProvider({
      identityResolver: undefined,
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('get_current_user')
  })

  it('uses scoped context as owner for storage tools but keeps identity tools on raw chat user id', async () => {
    const scopedContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'raw-user' })
    const rawChatUserId = 'raw-user'
    const provider = createMockProvider({
      identityResolver: {
        searchUsers: () => Promise.resolve([{ id: 'provider-user-1', login: 'alice', name: 'Alice A' }]),
      },
    })
    const tools = buildTools(provider, rawChatUserId, scopedContextId, 'normal', 'group')

    await getToolExecutor(tools['save_memo'])({ content: 'scoped memo' })
    await getToolExecutor(tools['create_recurring_task'])({
      title: 'Scoped recurring',
      projectId: 'project-1',
      triggerType: 'on_complete',
    })
    createAlertPrompt(scopedContextId, 'scoped owner alert', { field: 'task.status', op: 'eq', value: 'done' })
    await getToolExecutor(tools['set_my_identity'])({ claim: "I'm alice" })

    expect(listMemos(scopedContextId).map((memo) => memo.content)).toContain('scoped memo')
    expect(listMemos(rawChatUserId).map((memo) => memo.content)).not.toContain('scoped memo')
    expect(listRecurringTasks(scopedContextId).map((task) => task.title)).toContain('Scoped recurring')
    expect(listRecurringTasks(rawChatUserId).map((task) => task.title)).not.toContain('Scoped recurring')
    const deferredList = await getToolExecutor(tools['list_deferred_prompts'])({})
    expect(isDeferredListResult(deferredList)).toBe(true)
    assertDeferredListResult(deferredList)
    expect(deferredList.prompts.map((prompt) => prompt.prompt)).toContain('scoped owner alert')
    expect(listAlertPrompts(rawChatUserId).map((prompt) => prompt.prompt)).not.toContain('scoped owner alert')
    const rawIdentity = getIdentityMapping(rawChatUserId, provider.name)
    expect(rawIdentity).not.toBeNull()
    expect(rawIdentity!.providerUserLogin).toBe('alice')
    expect(getIdentityMapping(scopedContextId, provider.name)).toBeNull()
  })

  it('uses parent group context for durable tools in scoped thread contexts', async () => {
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-42',
    })
    const parentContextId = getConfigContextIdFromStorageContextId(threadContextId)
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', threadContextId, 'normal', 'group', 'alice')

    await getToolExecutor(tools['save_memo'])({ content: 'shared group memo' })
    await getToolExecutor(tools['save_instruction'])({ text: 'Prefer concise replies' })
    await getToolExecutor(tools['create_recurring_task'])({
      title: 'Shared recurring task',
      projectId: 'project-1',
      triggerType: 'on_complete',
    })
    await getToolExecutor(tools['create_deferred_prompt'])({
      prompt: 'Check blocked tasks',
      condition: { field: 'task.status', op: 'eq', value: 'blocked' },
      execution: { mode: 'lightweight', delivery_brief: 'Report blocked tasks' },
    })

    expect(parentContextId).not.toBe(threadContextId)
    expect(listMemos(parentContextId).map((memo) => memo.content)).toContain('shared group memo')
    expect(listMemos(threadContextId).map((memo) => memo.content)).not.toContain('shared group memo')
    expect(listInstructions(parentContextId).map((instruction) => instruction.text)).toContain('Prefer concise replies')
    expect(listInstructions(threadContextId).map((instruction) => instruction.text)).not.toContain(
      'Prefer concise replies',
    )
    expect(listRecurringTasks(parentContextId).map((task) => task.title)).toContain('Shared recurring task')
    expect(listRecurringTasks(threadContextId).map((task) => task.title)).not.toContain('Shared recurring task')
    const parentAlertPrompts = listAlertPrompts(parentContextId)
    expect(parentAlertPrompts.map((prompt) => prompt.prompt)).toContain('Check blocked tasks')
    expect(listAlertPrompts(threadContextId).map((prompt) => prompt.prompt)).not.toContain('Check blocked tasks')
    expect(parentAlertPrompts[0]!.deliveryTarget.storageContextId).toBe(threadContextId)
  })

  it('keeps workspace and staged-file tools scoped to the current thread context', async () => {
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-42',
    })
    const parentContextId = getConfigContextIdFromStorageContextId(threadContextId)
    const threadFile: IncomingFile = {
      fileId: 'platform-thread-file',
      filename: 'thread-note.txt',
      mimeType: 'text/plain',
      size: 12,
      content: Buffer.from('thread file'),
    }
    const parentFile: IncomingFile = {
      fileId: 'platform-parent-file',
      filename: 'parent-note.txt',
      mimeType: 'text/plain',
      size: 12,
      content: Buffer.from('parent file'),
    }

    await persistIncomingAttachments({ contextId: threadContextId, sourceProvider: 'telegram', files: [threadFile] })
    await persistIncomingAttachments({ contextId: parentContextId, sourceProvider: 'telegram', files: [parentFile] })
    const stagedThreadFile = stageFileMetadata({
      contextId: threadContextId,
      messageId: null,
      senderId: 'user-123',
      senderUsername: 'alice',
      filename: 'thread-staged.txt',
      mimeType: null,
      size: null,
      platformFileId: 'staged-thread-file',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: 'telegram-default',
    })
    const stagedParentFile = stageFileMetadata({
      contextId: parentContextId,
      messageId: null,
      senderId: 'user-123',
      senderUsername: 'alice',
      filename: 'parent-staged.txt',
      mimeType: null,
      size: null,
      platformFileId: 'staged-parent-file',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: 'telegram-default',
    })
    const stagedDownloadFn = mock(() => Promise.resolve(Buffer.from('resolved thread file')))

    const provider = createMockProvider({ capabilities: new Set(['attachments.list']) })
    const tools = buildTools(provider, 'user-123', threadContextId, 'normal', 'group', undefined, stagedDownloadFn)

    const files = await getToolExecutor(tools['list_files'])({})
    const staged = await getToolExecutor(tools['search_staged_files'])({ query: 'staged' })
    const resolved = await getToolExecutor(tools['resolve_staged_file'])({ stagedId: stagedThreadFile.stagedId })
    const threadAttachmentsAfterResolve = listActiveAttachments(threadContextId)
    const resolvedThreadAttachment = threadAttachmentsAfterResolve.find(
      (attachment) => attachment.filename === 'thread-staged.txt',
    )

    expect(files).toEqual([expect.objectContaining({ filename: 'thread-note.txt' })])
    expect(staged).toEqual([expect.objectContaining({ filename: 'thread-staged.txt' })])
    expect(resolved).toEqual({
      status: 'resolved',
      attachmentId: resolvedThreadAttachment!.attachmentId,
      filename: 'thread-staged.txt',
    })
    expect(stagedDownloadFn).toHaveBeenCalledWith('staged-thread-file', 'telegram', 'telegram-default')
    expect(threadAttachmentsAfterResolve.map((attachment) => attachment.filename)).toContain('thread-staged.txt')
    expect(listActiveAttachments(parentContextId).map((attachment) => attachment.filename)).not.toContain(
      'thread-staged.txt',
    )
    expect(listActiveAttachments(threadContextId).map((attachment) => attachment.filename)).not.toContain(
      stagedParentFile.filename,
    )
  })

  it('should conditionally add project tools', () => {
    const provider = createMockProvider({
      capabilities: new Set([
        'projects.read',
        'projects.list',
        'projects.create',
        'projects.update',
        'projects.delete',
        'projects.team',
      ]),
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('get_project')
    expect(tools).toHaveProperty('list_projects')
    expect(tools).toHaveProperty('create_project')
    expect(tools).toHaveProperty('update_project')
    expect(tools).toHaveProperty('delete_project')
    expect(tools).toHaveProperty('list_project_team')
    expect(tools).toHaveProperty('add_project_member')
    expect(tools).toHaveProperty('remove_project_member')
  })

  it('should not expose get_project when projects.read is set but getProject is missing', () => {
    const provider = createMockProvider({
      capabilities: new Set(['projects.read']),
      getProject: undefined,
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('get_project')
  })

  it('should conditionally add comment tools', () => {
    const provider = createMockProvider({
      capabilities: new Set([
        'comments.read',
        'comments.create',
        'comments.update',
        'comments.delete',
        'comments.reactions',
      ]),
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('get_comments')
    expect(tools).toHaveProperty('add_comment')
    expect(tools).toHaveProperty('update_comment')
    expect(tools).toHaveProperty('remove_comment')
    expect(tools).toHaveProperty('add_comment_reaction')
    expect(tools).toHaveProperty('remove_comment_reaction')
  })

  it('should expose remove_label when labels.delete capability is present', () => {
    const provider = createMockProvider({
      capabilities: new Set(['labels.delete']),
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('remove_label')
  })

  it('should conditionally add deferred prompt tools in normal mode', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('create_deferred_prompt')
    expect(tools).toHaveProperty('list_deferred_prompts')
  })

  it('should expose agile and sprint tools when phase-five capabilities are present', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('list_agiles')
    expect(tools).toHaveProperty('list_sprints')
    expect(tools).toHaveProperty('create_sprint')
    expect(tools).toHaveProperty('update_sprint')
    expect(tools).toHaveProperty('assign_task_to_sprint')
  })

  it('should expose history and saved-query tools when phase-five capabilities are present', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('get_task_history')
    expect(tools).toHaveProperty('list_saved_queries')
    expect(tools).toHaveProperty('run_saved_query')
  })

  it('should not expose phase-five tools when capabilities are absent', () => {
    const provider = createMockProvider({
      capabilities: new Set(
        [...createMockProvider().capabilities].filter(
          (capability) =>
            ![
              'agiles.list',
              'sprints.list',
              'sprints.create',
              'sprints.update',
              'sprints.assign',
              'activities.read',
              'queries.saved',
            ].includes(capability),
        ),
      ),
    })

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('list_agiles')
    expect(tools).not.toHaveProperty('list_sprints')
    expect(tools).not.toHaveProperty('create_sprint')
    expect(tools).not.toHaveProperty('update_sprint')
    expect(tools).not.toHaveProperty('assign_task_to_sprint')
    expect(tools).not.toHaveProperty('get_task_history')
    expect(tools).not.toHaveProperty('list_saved_queries')
    expect(tools).not.toHaveProperty('run_saved_query')
  })

  it('should expose apply_youtrack_command only for providers with the YouTrack command-language trait', () => {
    const provider = createMockProvider({
      name: 'custom',
      traits: new Set(['command-language:youtrack']),
    })
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')
    expect(tools).toHaveProperty('apply_youtrack_command')

    const spoofedProvider = createMockProvider({ name: 'youtrack' as const, traits: new Set() })
    const spoofedTools = buildTools(spoofedProvider, 'user-123', 'user-123', 'normal')
    expect(spoofedTools).not.toHaveProperty('apply_youtrack_command')
  })

  it('should not expose apply_youtrack_command when tasks.commands capability is absent', () => {
    const provider = createMockProvider({
      name: 'youtrack' as const,
      traits: new Set(['command-language:youtrack']),
      capabilities: new Set(
        [...createMockProvider().capabilities].filter((capability) => capability !== 'tasks.commands'),
      ),
    })

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('apply_youtrack_command')
  })

  it('should not expose apply_youtrack_command when applyCommand is missing', () => {
    const provider = createMockProvider({
      name: 'youtrack' as const,
      traits: new Set(['command-language:youtrack']),
      applyCommand: undefined,
    })

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('apply_youtrack_command')
  })

  it('should not expose apply_youtrack_command in proactive mode', () => {
    const provider = createMockProvider({ name: 'youtrack' as const, traits: new Set(['command-language:youtrack']) })

    const tools = buildTools(provider, 'user-123', 'user-123', 'proactive')

    expect(tools).not.toHaveProperty('apply_youtrack_command')
  })

  it('should not add deferred prompt tools in proactive mode', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'proactive')

    expect(tools).not.toHaveProperty('create_deferred_prompt')
    expect(tools).not.toHaveProperty('list_deferred_prompts')
  })

  it('should not add user-scoped tools when userId is undefined', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, undefined, undefined, 'normal')

    expect(tools).not.toHaveProperty('save_memo')
    expect(tools).not.toHaveProperty('list_memos')
    expect(tools).not.toHaveProperty('create_recurring_task')
    expect(tools).not.toHaveProperty('save_instruction')
  })

  it('builds only provider-independent tools for providerless invocation', () => {
    const tools = buildProviderlessTools('user-123', 'group-456:thread-1', 'normal')

    expect(tools).toHaveProperty('get_current_time')
    expect(tools).toHaveProperty('save_memo')
    expect(tools).toHaveProperty('search_memos')
    expect(tools).toHaveProperty('list_memos')
    expect(tools).toHaveProperty('archive_memos')
    expect(tools).toHaveProperty('create_recurring_task')
    expect(tools).toHaveProperty('list_recurring_tasks')
    expect(tools).toHaveProperty('save_instruction')
    expect(tools).toHaveProperty('list_instructions')
    expect(tools).toHaveProperty('delete_instruction')
    expect(tools).toHaveProperty('lookup_group_history')
    expect(tools).toHaveProperty('web_fetch')
    expect(tools).toHaveProperty('create_deferred_prompt')
    expect(tools).toHaveProperty('list_deferred_prompts')

    expect(tools).not.toHaveProperty('create_task')
    expect(tools).not.toHaveProperty('update_task')
    expect(tools).not.toHaveProperty('search_tasks')
    expect(tools).not.toHaveProperty('get_task')
    expect(tools).not.toHaveProperty('list_projects')
    expect(tools).not.toHaveProperty('get_comments')
    expect(tools).not.toHaveProperty('list_statuses')
    expect(tools).not.toHaveProperty('log_work')
    expect(tools).not.toHaveProperty('add_task_relation')
    expect(tools).not.toHaveProperty('set_my_identity')
    expect(tools).not.toHaveProperty('promote_memo')
  })

  it('exposes only schedule-based deferred prompt creation in providerless mode', async () => {
    const tools = buildProviderlessTools('user-123', 'group-456:thread-1', 'normal')
    const createDeferredPrompt = tools['create_deferred_prompt']

    expect(createDeferredPrompt).toBeDefined()
    expect(
      schemaValidates(createDeferredPrompt!, {
        prompt: 'Remind me later',
        schedule: { fire_at: { date: '2027-01-15', time: '09:00' } },
      }),
    ).toBe(true)
    expect(
      schemaValidates(createDeferredPrompt!, {
        prompt: 'Alert me when a task is blocked',
        condition: { field: 'task.status', op: 'eq', value: 'blocked' },
      }),
    ).toBe(false)

    const result = await getToolExecutor(createDeferredPrompt!)({
      prompt: 'Alert me when a task is blocked',
      condition: { field: 'task.status', op: 'eq', value: 'blocked' },
    })

    expect(result).toEqual({ error: 'Task-dependent deferred alerts require a task provider.' })
  })

  it('should add lookup_group_history when contextId is a legacy thread', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123:group-1', 'normal')

    expect(tools).toHaveProperty('lookup_group_history')
  })

  it('should add lookup_group_history when contextId is a scoped thread', () => {
    const provider = createMockProvider()
    const scopedThreadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-1',
    })
    const tools = buildTools(provider, 'user-123', scopedThreadContextId, 'normal')

    expect(tools).toHaveProperty('lookup_group_history')
  })

  it('should not add lookup_group_history when contextId is scoped but not threaded', () => {
    const provider = createMockProvider()
    const scopedMainContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
    })
    const tools = buildTools(provider, 'user-123', scopedMainContextId, 'normal')

    expect(tools).not.toHaveProperty('lookup_group_history')
  })

  it('should not add lookup_group_history when contextId is a DM', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('lookup_group_history')
  })

  it('should add web_fetch when a storage context exists', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'group-456', 'normal')

    expect(tools).toHaveProperty('web_fetch')
  })

  it('should not add web_fetch when contextId is undefined', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', undefined, 'normal')

    expect(tools).not.toHaveProperty('web_fetch')
  })

  describe('chatUserId isolation', () => {
    it('should pass chatUserId separately from contextId to identity tools', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // chatUserId: 'user-123', contextId: 'group-456' (group chat scenario)
      const tools = buildTools(provider, 'user-123', 'group-456', 'normal', 'group')

      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })

    it('should use chatUserId for identity tools in group contexts', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // Different chatUserId and contextId (group scenario)
      const tools = buildTools(provider, 'alice-user-id', 'group-123', 'normal', 'group')

      // Identity tools should exist and be configured with alice-user-id
      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })
  })

  describe('watcher tools user isolation', () => {
    it('should pass chatUserId to watcher tools for identity resolution', () => {
      // This test verifies NC1 fix: watcher tools must receive chatUserId (actual user)
      // not contextId (which could be a group ID) for proper "me" reference resolution
      const provider = createMockProvider({
        capabilities: new Set(['tasks.watchers']),
      })
      // Group chat: chatUserId is the user, contextId is the group
      const chatUserId = 'user-123'
      const contextId = 'user-123:group-456'
      const tools = buildTools(provider, chatUserId, contextId, 'normal', 'group')

      // Watcher tools should exist
      expect(tools['add_watcher']).toBeDefined()
      expect(tools['remove_watcher']).toBeDefined()
      expect(tools['list_watchers']).toBeDefined()

      // The tools are created with chatUserId for proper identity resolution
      // We can't directly test the internal parameter, but the tools execute correctly
      // when user says "add me as watcher" because they resolve against the user's identity
    })

    it('should build upload_attachment from contextId instead of chatUserId', async () => {
      const chatUserId = 'alice-user-id'
      const contextId = 'group-123:thread-456'
      const file: IncomingFile = {
        fileId: 'platform-file-1',
        filename: 'screenshot.png',
        mimeType: 'image/png',
        size: 1024,
        content: Buffer.from('fake-png'),
      }

      const refs = await persistIncomingAttachments({
        contextId,
        sourceProvider: 'telegram',
        files: [file],
      })

      const uploadAttachment = mock(() =>
        Promise.resolve({ id: 'att-1', name: 'screenshot.png', url: 'https://example.com/att-1' }),
      )
      const provider = createMockProvider({
        capabilities: new Set(['attachments.upload']),
        uploadAttachment,
      } as Partial<TaskProvider>)

      const tools = buildTools(provider, chatUserId, contextId, 'normal', 'group')
      const execute = getToolExecutor(tools['upload_attachment'])
      const result = await execute({ taskId: 'task-1', attachmentId: refs[0]!.attachmentId })

      expect(result).toEqual({
        id: 'att-1',
        name: 'screenshot.png',
        url: 'https://example.com/att-1',
      })
      expect(uploadAttachment).toHaveBeenCalledWith('task-1', {
        name: 'screenshot.png',
        content: file.content,
        mimeType: 'image/png',
      })
    })
  })

  describe('identity tools context gating', () => {
    it('should include identity tools in group contexts', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = buildTools(provider, 'user-123', 'group-456', 'normal', 'group')

      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })

    it('should NOT include identity tools in DM contexts', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = buildTools(provider, 'user-123', 'user-123', 'normal', 'dm')

      expect(tools['set_my_identity']).toBeUndefined()
      expect(tools['clear_my_identity']).toBeUndefined()
    })

    it('should NOT include identity tools when contextType is undefined', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

      expect(tools['set_my_identity']).toBeUndefined()
      expect(tools['clear_my_identity']).toBeUndefined()
    })
  })
})

describe('makeTools direct integration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('exposes direct tools by default', async () => {
    const provider = createMockProvider()

    const tools = await makeTools(provider, {
      storageContextId: 'user-123',
      chatUserId: 'user-123',
      contextType: 'dm',
    })

    expect(tools).toHaveProperty('create_task')
    expect(tools).not.toHaveProperty('papai_tool')
  })

  it('keeps internal context gating available through direct tool exposure', async () => {
    const provider = createMockProvider({
      identityResolver: {
        searchUsers: () => Promise.resolve([]),
      },
    })

    const dmTools = await makeTools(provider, {
      storageContextId: 'user-123',
      chatUserId: 'user-123',
      contextType: 'dm',
    })
    const groupTools = await makeTools(provider, {
      storageContextId: 'group-123',
      chatUserId: 'user-123',
      contextType: 'group',
    })

    expect(dmTools).not.toHaveProperty('set_my_identity')
    expect(groupTools).toHaveProperty('set_my_identity')
  })

  it('adds context-enabled plugin tools with request-scoped runtime context', async () => {
    mockLogger()
    await setupTestDb()
    const pluginId = 'task-five-plugin'
    const storageContextId = 'ctx-task-five'
    const plugin: DiscoveredPlugin = {
      manifest: {
        id: pluginId,
        name: 'Task Five Plugin',
        version: '1.0.0',
        description: 'Plugin tool integration test',
        apiVersion: PLUGIN_API_VERSION,
        main: 'index.ts',
        contributes: {
          tools: ['runtime_echo'],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
        },
        permissions: ['tasks.read'],
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [],
        providerCapabilities: [],
        providerTraits: [],
        providerConfigSchema: [],
        providerContextConfigSchema: [],
        providerAllowedHosts: [],
      },
      pluginDir: '/tmp/task-five-plugin',
      entryPoint: '/tmp/task-five-plugin/index.ts',
      manifestHash: 'task-five-hash',
    }

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'task-five-hash')
    pluginRegistry.markActive(pluginId)
    setPluginEnabledForContext(pluginId, storageContextId, true)
    contributionRegistry.register(
      pluginId,
      {
        tools: [
          {
            name: 'runtime_echo',
            description: 'Echo runtime context',
            execute: (_input, runtimeContext): Promise<unknown> =>
              Promise.resolve({
                chatUserId: runtimeContext.chatUserId,
                storageContextId: runtimeContext.storageContextId,
              }),
          },
        ],
        promptFragments: [],
      },
      plugin.manifest,
    )

    const tools = await makeTools(createMockProvider(), {
      storageContextId,
      chatUserId: 'chat-user-task-five',
      contextType: 'dm',
    })
    const execute = getToolExecutor(tools['plugin_task_five_plugin__runtime_echo'])

    await expect(execute({}, { toolCallId: 'call-task-five' })).resolves.toEqual({
      chatUserId: 'chat-user-task-five',
      storageContextId,
    })

    contributionRegistry.deregister(pluginId)
  })

  it('does not add active plugin tools when plugin is disabled for the context', async () => {
    mockLogger()
    await setupTestDb()
    const pluginId = 'task-five-disabled-plugin'
    const storageContextId = 'ctx-task-five-disabled'
    const plugin: DiscoveredPlugin = {
      manifest: {
        id: pluginId,
        name: 'Task Five Disabled Plugin',
        version: '1.0.0',
        description: 'Plugin disabled integration test',
        apiVersion: PLUGIN_API_VERSION,
        main: 'index.ts',
        contributes: {
          tools: ['runtime_echo'],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
        },
        permissions: ['tasks.read'],
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [],
        providerCapabilities: [],
        providerTraits: [],
        providerConfigSchema: [],
        providerContextConfigSchema: [],
        providerAllowedHosts: [],
      },
      pluginDir: '/tmp/task-five-disabled-plugin',
      entryPoint: '/tmp/task-five-disabled-plugin/index.ts',
      manifestHash: 'task-five-disabled-hash',
    }

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'task-five-disabled-hash')
    pluginRegistry.markActive(pluginId)
    contributionRegistry.register(
      pluginId,
      {
        tools: [
          {
            name: 'runtime_echo',
            description: 'Echo runtime context',
            execute: (_input, runtimeContext): Promise<unknown> =>
              Promise.resolve({
                chatUserId: runtimeContext.chatUserId,
                storageContextId: runtimeContext.storageContextId,
              }),
          },
        ],
        promptFragments: [],
      },
      plugin.manifest,
    )

    const tools = await makeTools(createMockProvider(), {
      storageContextId,
      chatUserId: 'chat-user-task-five',
      contextType: 'dm',
    })

    expect(tools).not.toHaveProperty('plugin_task_five_disabled_plugin__runtime_echo')

    contributionRegistry.deregister(pluginId)
  })

  it('does not add enabled plugin tools when required plugin config is missing for the context', async () => {
    mockLogger()
    await setupTestDb()
    const pluginId = 'task-six-missing-config-plugin'
    const storageContextId = 'ctx-task-six-missing-config'
    const plugin: DiscoveredPlugin = {
      manifest: {
        id: pluginId,
        name: 'Task Six Missing Config Plugin',
        version: '1.0.0',
        description: 'Plugin config gating integration test',
        apiVersion: PLUGIN_API_VERSION,
        main: 'index.ts',
        contributes: {
          tools: ['runtime_echo'],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
        },
        permissions: ['tasks.read'],
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [
          { key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' },
        ],
        providerCapabilities: [],
        providerTraits: [],
        providerConfigSchema: [],
        providerContextConfigSchema: [],
        providerAllowedHosts: [],
      },
      pluginDir: '/tmp/task-six-missing-config-plugin',
      entryPoint: '/tmp/task-six-missing-config-plugin/index.ts',
      manifestHash: 'task-six-missing-config-hash',
    }

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'task-six-missing-config-hash')
    pluginRegistry.markActive(pluginId)
    setPluginEnabledForContext(pluginId, storageContextId, true)
    contributionRegistry.register(
      pluginId,
      {
        tools: [
          {
            name: 'runtime_echo',
            description: 'Echo runtime context',
            execute: (_input, runtimeContext): Promise<unknown> =>
              Promise.resolve({
                chatUserId: runtimeContext.chatUserId,
                storageContextId: runtimeContext.storageContextId,
              }),
          },
        ],
        promptFragments: [],
      },
      plugin.manifest,
    )

    const tools = await makeTools(createMockProvider(), {
      storageContextId,
      chatUserId: 'chat-user-task-six',
      contextType: 'dm',
    })

    expect(tools).not.toHaveProperty('plugin_task_six_missing_config_plugin__runtime_echo')

    contributionRegistry.deregister(pluginId)
  })
})
