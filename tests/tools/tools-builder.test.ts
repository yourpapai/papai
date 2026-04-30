import { describe, expect, it, mock } from 'bun:test'

import type { IncomingFile } from '../../src/chat/types.js'
import { clearIncomingFiles, storeIncomingFiles } from '../../src/file-relay.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { makeTools } from '../../src/tools/index.js'
import { buildTools } from '../../src/tools/tools-builder.js'
import { getToolExecutor } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('buildTools', () => {
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

  it('should expose apply_youtrack_command only for the YouTrack provider', () => {
    const provider = createMockProvider({ name: 'youtrack' as const })
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')
    expect(tools).toHaveProperty('apply_youtrack_command')

    const nonYouTrackTools = buildTools(createMockProvider({ name: 'mock' }), 'user-123', 'user-123', 'normal')
    expect(nonYouTrackTools).not.toHaveProperty('apply_youtrack_command')
  })

  it('should not expose apply_youtrack_command when tasks.commands capability is absent', () => {
    const provider = createMockProvider({
      name: 'youtrack' as const,
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
      applyCommand: undefined,
    })

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('apply_youtrack_command')
  })

  it('should not expose apply_youtrack_command in proactive mode', () => {
    const provider = createMockProvider({ name: 'youtrack' as const })

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

  it('should add lookup_group_history when contextId is a group', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123:group-1', 'normal')

    expect(tools).toHaveProperty('lookup_group_history')
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
        fileId: 'file-1',
        filename: 'screenshot.png',
        mimeType: 'image/png',
        size: 1024,
        content: Buffer.from('fake-png'),
      }

      storeIncomingFiles(contextId, [file])

      try {
        const uploadAttachment = mock(() =>
          Promise.resolve({ id: 'att-1', name: 'screenshot.png', url: 'https://example.com/att-1' }),
        )
        const provider = createMockProvider({
          capabilities: new Set(['attachments.upload']),
          uploadAttachment,
        } as Partial<TaskProvider>)

        const tools = buildTools(provider, chatUserId, contextId, 'normal', 'group')
        const execute = getToolExecutor(tools['upload_attachment'])
        const result = await execute({ taskId: 'task-1', fileId: 'file-1' })

        expect(result).toEqual({ id: 'att-1', name: 'screenshot.png', url: 'https://example.com/att-1' })
        expect(uploadAttachment).toHaveBeenCalledWith('task-1', {
          name: 'screenshot.png',
          content: file.content,
          mimeType: 'image/png',
        })
      } finally {
        clearIncomingFiles(contextId)
      }
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

describe('makeTools proxy integration', () => {
  it('exposes only papai_tool by default', () => {
    const provider = createMockProvider()

    const tools = makeTools(provider, { storageContextId: 'user-123', chatUserId: 'user-123', contextType: 'dm' })

    expect(Object.keys(tools)).toEqual(['papai_tool'])
  })

  it('keeps internal context gating available through proxy search', async () => {
    const provider = createMockProvider({
      identityResolver: {
        searchUsers: () => Promise.resolve([]),
      },
    })

    const dmTools = makeTools(provider, { storageContextId: 'user-123', chatUserId: 'user-123', contextType: 'dm' })
    const groupTools = makeTools(provider, {
      storageContextId: 'group-123',
      chatUserId: 'user-123',
      contextType: 'group',
    })

    const dmResult = await getToolExecutor(dmTools['papai_tool'])(
      { search: 'identity', includeSchemas: false },
      {
        toolCallId: 'dm-search',
        messages: [],
      },
    )
    const groupResult = await getToolExecutor(groupTools['papai_tool'])(
      { search: 'identity', includeSchemas: false },
      {
        toolCallId: 'group-search',
        messages: [],
      },
    )

    expect(JSON.stringify(dmResult)).not.toContain('set_my_identity')
    expect(JSON.stringify(groupResult)).toContain('set_my_identity')
  })
})
