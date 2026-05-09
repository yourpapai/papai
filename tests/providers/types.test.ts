import { describe, expect, test } from 'bun:test'

import type {
  Attachment,
  Comment,
  CommentReaction,
  IdentityUser,
  SetTaskVisibilityParams,
  Task,
  TaskCapability,
  TaskListItem,
  TaskProvider,
  TaskVisibility,
  UserIdentityResolver,
  UserRef,
} from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'

describe('Attachment type', () => {
  test('Attachment accepts all fields', () => {
    const attachment: Attachment = {
      id: 'a-1',
      name: 'document.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      url: 'https://example.com/file.pdf',
      thumbnailUrl: 'https://example.com/thumb.png',
      author: 'alice',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    expect(attachment.id).toBe('a-1')
    expect(attachment.url).toBe('https://example.com/file.pdf')
  })

  test('Attachment requires only id, name, url', () => {
    const attachment: Attachment = {
      id: 'a-1',
      name: 'file.pdf',
      url: 'https://example.com/file.pdf',
    }
    expect(attachment.name).toBe('file.pdf')
  })
})

describe('Task type', () => {
  test('Task accepts optional extended fields', () => {
    const task: Task = {
      id: 'PROJ-1',
      title: 'Test Task',
      url: 'https://example.com/issue/PROJ-1',
      number: 42,
      reporter: { id: 'u-1', login: 'alice', name: 'Alice Smith' },
      updater: { id: 'u-2', login: 'bob', name: 'Bob Jones' },
      votes: 5,
      commentsCount: 3,
      resolved: '2024-01-01T00:00:00.000Z',
      attachments: [{ id: 'a-1', name: 'file.pdf', url: 'https://example.com/file.pdf' }],
      watchers: [{ id: 'u-3', login: 'watcher' }],
      visibility: {
        kind: 'restricted',
        users: [{ id: 'u-1', login: 'alice', name: 'Alice Smith' }],
        groups: [{ id: 'g-1', name: 'Maintainers' }],
      },
      parent: { id: '100', idReadable: 'PROJ-0', title: 'Parent' },
      subtasks: [{ id: '200', idReadable: 'PROJ-2', title: 'Subtask', status: undefined }],
    }
    expect(task.number).toBe(42)
    expect(task.reporter?.name).toBe('Alice Smith')
    expect(task.votes).toBe(5)
    expect(task.watchers?.[0]?.login).toBe('watcher')
    expect(task.visibility?.kind).toBe('restricted')
  })
})

describe('TaskListItem type', () => {
  test('TaskListItem accepts number and resolved', () => {
    const item: TaskListItem = {
      id: 'PROJ-1',
      title: 'Test Task',
      number: 42,
      resolved: '2024-01-01T00:00:00.000Z',
      url: 'https://example.com/issue/PROJ-1',
    }
    expect(item.number).toBe(42)
    expect(item.resolved).toBe('2024-01-01T00:00:00.000Z')
  })
})

describe('collaboration domain types', () => {
  test('UserRef and TaskVisibility accept structured collaboration data', () => {
    const user: UserRef = {
      id: 'u-1',
      login: 'alice',
      name: 'Alice Smith',
    }
    const visibility: TaskVisibility = {
      kind: 'restricted',
      users: [user],
      groups: [{ id: 'g-1', name: 'Maintainers' }],
    }
    const params: SetTaskVisibilityParams = {
      kind: 'restricted',
      userIds: ['u-1'],
      groupIds: ['g-1'],
    }

    expect(visibility.users?.[0]?.name).toBe('Alice Smith')
    expect(params.groupIds).toEqual(['g-1'])
  })

  test('Comment accepts normalized reactions with removable ids', () => {
    const reaction: CommentReaction = {
      id: 'reaction-1',
      reaction: 'thumbs_up',
      author: { id: 'u-1', login: 'alice' },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const comment: Comment = {
      id: 'comment-1',
      body: 'Looks good',
      reactions: [reaction],
    }

    expect(comment.reactions?.[0]?.id).toBe('reaction-1')
    expect(comment.reactions?.[0]?.reaction).toBe('thumbs_up')
  })
})

describe('TaskProvider collaboration methods', () => {
  test('TaskProvider accepts optional collaboration methods and capabilities', async () => {
    const capabilities: TaskCapability[] = [
      'tasks.watchers',
      'tasks.votes',
      'tasks.visibility',
      'comments.reactions',
      'projects.team',
    ]

    const provider: TaskProvider = createMockProvider()
    const currentUser = await provider.getCurrentUser?.()
    const visibility = await provider.setVisibility?.('PROJ-1', { kind: 'public' })
    const team = await provider.listProjectTeam?.('PROJ')

    expect(capabilities).toHaveLength(5)
    expect(currentUser?.id).toBe('user-1')
    expect(visibility).toEqual({ taskId: 'PROJ-1', visibility: { kind: 'public' } })
    expect(team?.[0]?.id).toBe('user-1')
  })
})

describe('Identity types', () => {
  test('IdentityUser accepts required and optional fields', () => {
    const user: IdentityUser = {
      id: 'u-1',
      login: 'alice',
      name: 'Alice Smith',
    }
    expect(user.id).toBe('u-1')
    expect(user.login).toBe('alice')
    expect(user.name).toBe('Alice Smith')
  })

  test('IdentityUser works without optional name', () => {
    const user: IdentityUser = {
      id: 'u-2',
      login: 'bob',
    }
    expect(user.id).toBe('u-2')
    expect(user.login).toBe('bob')
    expect(user.name).toBeUndefined()
  })

  test('UserIdentityResolver interface is implemented correctly', async () => {
    const mockResolver: UserIdentityResolver = {
      searchUsers(query: string, _limit: number = 10): Promise<IdentityUser[]> {
        const users: IdentityUser[] = [
          { id: 'u-1', login: 'alice', name: 'Alice Smith' },
          { id: 'u-2', login: 'bob', name: 'Bob Jones' },
        ]
        return Promise.resolve(users.filter((u) => u.login.includes(query)).slice(0, _limit))
      },
    }

    const results = await mockResolver.searchUsers('ali', 5)
    expect(results).toHaveLength(1)
    expect(results[0]?.login).toBe('alice')
  })

  test('TaskProvider accepts optional identityResolver', () => {
    const resolver: UserIdentityResolver = {
      searchUsers(query: string): Promise<IdentityUser[]> {
        return Promise.resolve([{ id: 'u-1', login: query }])
      },
    }

    const provider: TaskProvider = createMockProvider({ identityResolver: resolver })
    expect(provider.identityResolver).toBeDefined()
    expect(typeof provider.identityResolver?.searchUsers).toBe('function')
  })
})
