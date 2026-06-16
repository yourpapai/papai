// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { z } from 'zod'

import {
  mapIssueToTask,
  mapIssueToListItem,
  mapIssueToSearchResult,
  mapComment,
} from '../../../plugins/task-provider-youtrack/mappers.js'

describe('mapIssueToTask', () => {
  test('maps basic issue fields', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      description: 'Task description',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1', name: 'Project', shortName: 'PROJ' },
      customFields: [
        {
          $type: 'SingleEnumIssueCustomField' as const,
          name: 'State',
          value: { $type: 'EnumBundleElement' as const, name: 'Open' },
        },
        {
          $type: 'SingleEnumIssueCustomField' as const,
          name: 'Priority',
          value: { $type: 'EnumBundleElement' as const, name: 'High' },
        },
        {
          $type: 'SingleUserIssueCustomField' as const,
          name: 'Assignee',
          value: { id: 'u-1', login: 'alice' },
        },
      ],
      tags: [{ id: 'tag-1', name: 'bug', color: { background: '#ff0000' } }],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.id).toBe('PROJ-1')
    expect(result.title).toBe('Test Task')
    expect(result.description).toBe('Task description')
    expect(result.status).toBe('Open')
    expect(result.priority).toBe('High')
    expect(result.assignee).toBe('alice')
    expect(result.projectId).toBe('proj-1')
    expect(result.url).toBe('https://example.com/issue/PROJ-1')
    expect(result.labels).toEqual([{ id: 'tag-1', name: 'bug', color: '#ff0000' }])
  })

  test('extracts reporter and updater', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      reporter: { id: 'u-1', login: 'alice', fullName: 'Alice Smith' },
      updater: { id: 'u-2', login: 'bob', fullName: 'Bob Jones' },
      votes: 5,
      commentsCount: 3,
      numberInProject: 1,
      resolved: 1704067200000,
      attachments: [{ id: 'a-1', name: 'file.pdf', url: 'https://example.com/file.pdf' }],
      parent: { issues: [{ id: '100', idReadable: 'PROJ-0', summary: 'Parent Task' }] },
      subtasks: {
        issues: [{ id: '200', idReadable: 'PROJ-2', summary: 'Subtask' }],
      },
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.reporter).toEqual({ id: 'u-1', login: 'alice', name: 'Alice Smith' })
    expect(result.updater).toEqual({ id: 'u-2', login: 'bob', name: 'Bob Jones' })
    expect(result.votes).toBe(5)
    expect(result.commentsCount).toBe(3)
    expect(result.number).toBe(1)
    expect(result.resolved).toBe('2024-01-01T00:00:00.000Z')
    expect(result.parent).toEqual({ id: '100', idReadable: 'PROJ-0', title: 'Parent Task' })
    expect(result.subtasks).toEqual([{ id: '200', idReadable: 'PROJ-2', title: 'Subtask', status: 'open' }])
  })

  test('maps due date custom field as date-only string', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [
        {
          $type: 'DateIssueCustomField' as const,
          name: 'Due Date',
          value: Date.parse('2026-03-25T12:00:00.000Z'),
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.dueDate).toBe('2026-03-25')
  })

  test('maps subtask status based on resolved field', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      subtasks: {
        issues: [
          { id: '200', idReadable: 'PROJ-2', summary: 'Resolved Subtask', resolved: 1704067200000 },
          { id: '201', idReadable: 'PROJ-3', summary: 'Unresolved Subtask' },
        ],
      },
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.subtasks).toHaveLength(2)
    expect(result.subtasks?.[0]?.status).toBe('resolved')
    expect(result.subtasks?.[1]?.status).toBe('open')
  })

  test('handles missing reporter and updater', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.reporter).toBeUndefined()
    expect(result.updater).toBeUndefined()
    expect(result.votes).toBeUndefined()
    expect(result.commentsCount).toBeUndefined()
    expect(result.number).toBeUndefined()
    expect(result.resolved).toBeUndefined()
    expect(result.attachments).toBeUndefined()
    expect(result.visibility).toBeUndefined()
    expect(result.parent).toBeUndefined()
    expect(result.subtasks).toBeUndefined()
  })

  test('handles null resolved timestamp', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      resolved: null,
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.resolved).toBeUndefined()
  })

  test('extracts attachments and visibility', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      attachments: [
        {
          id: 'a-1',
          name: 'file.pdf',
          url: 'https://example.com/file.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          thumbnailURL: 'https://example.com/thumb.png',
          author: { login: 'alice' },
          created: 1704067200000,
        },
        { id: 'a-2', name: 'image.png', url: 'https://example.com/image.png' },
      ],
      watchers: {
        hasStar: true,
        issueWatchers: [
          {
            isStarred: true,
            user: {
              id: 'user-1',
              login: 'alice',
              fullName: 'Alice Example',
              email: 'alice@example.com',
            },
          },
          {
            isStarred: false,
            user: {
              id: 'user-2',
              login: 'bob',
              fullName: 'Bob Example',
            },
          },
        ],
      },
      visibility: {
        $type: 'LimitedVisibility',
        permittedGroups: [{ id: 'group-1', name: 'team-a' }],
        permittedUsers: [{ id: 'user-1', login: 'alice', fullName: 'Alice Example' }],
      },
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.attachments).toHaveLength(2)
    expect(result.attachments?.[0]).toEqual({
      id: 'a-1',
      name: 'file.pdf',
      url: 'https://example.com/file.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      thumbnailUrl: 'https://example.com/thumb.png',
      author: 'alice',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    expect(result.attachments?.[1]).toEqual({
      id: 'a-2',
      name: 'image.png',
      url: 'https://example.com/image.png',
      mimeType: undefined,
      size: undefined,
      thumbnailUrl: undefined,
      author: undefined,
      createdAt: undefined,
    })
    expect(result.watchers).toEqual([
      { id: 'user-1', login: 'alice', name: 'Alice Example' },
      { id: 'user-2', login: 'bob', name: 'Bob Example' },
    ])
    expect(result.visibility).toEqual({
      kind: 'restricted',
      groups: [{ id: 'group-1', name: 'team-a' }],
      users: [{ id: 'user-1', login: 'alice', name: 'Alice Example' }],
    })
  })

  test('maps links to relations', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'OUTWARD',
          linkType: { id: 'lt-1', name: 'Depend' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Blocking Task' }],
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.relations).toEqual([{ type: 'blocks', taskId: 'PROJ-2' }])
  })

  test('omits relations when empty', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.relations).toBeUndefined()
  })

  test('uses id when idReadable missing', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')

    expect(result.id).toBe('PROJ-1')
    expect(result.url).toBe('https://example.com/issue/PROJ-1')
  })

  test('maps duplicate relation type', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'OUTWARD',
          linkType: { id: 'lt-1', name: 'Duplicate' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Duplicate Task' }],
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')
    expect(result.relations).toEqual([{ type: 'duplicate', taskId: 'PROJ-2' }])
  })

  test('maps subtask relation type', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'INWARD',
          linkType: { id: 'lt-1', name: 'Subtask' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Subtask' }],
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')
    expect(result.relations).toEqual([{ type: 'child', taskId: 'PROJ-2' }])
  })

  test('maps subtask OUTWARD direction as parent', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'OUTWARD',
          linkType: { id: 'lt-1', name: 'Subtask' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Parent Task' }],
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')
    expect(result.relations).toEqual([{ type: 'parent', taskId: 'PROJ-2' }])
  })

  test('maps unknown relation type to related', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [],
      links: [
        {
          id: 'link-1',
          direction: 'BOTH',
          linkType: { id: 'lt-1', name: 'Relates' },
          issues: [{ id: '456', idReadable: 'PROJ-2', summary: 'Related Task' }],
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')
    expect(result.relations).toEqual([{ type: 'related', taskId: 'PROJ-2' }])
  })

  test('handles custom field value as string', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [{ $type: 'SimpleIssueCustomField' as const, name: 'State', value: 'Open' }],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')
    expect(result.status).toBe('Open')
  })

  test('handles custom field object without name or login', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test',
      created: 1704067200000,
      updated: 1704153600000,
      project: { id: 'proj-1' },
      customFields: [
        {
          $type: 'SingleEnumIssueCustomField' as const,
          name: 'State',
          value: { $type: 'EnumBundleElement' as const, name: 'Open' },
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueSchema>

    const result = mapIssueToTask(issue, 'https://example.com')
    expect(result.status).toBe('Open')
  })
})

describe('mapIssueToListItem', () => {
  test('maps list item fields', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      project: { id: 'proj-1', shortName: 'PROJ' },
      customFields: [
        {
          $type: 'SingleEnumIssueCustomField' as const,
          name: 'State',
          value: { $type: 'EnumBundleElement' as const, name: 'Open' },
        },
        {
          $type: 'SingleEnumIssueCustomField' as const,
          name: 'Priority',
          value: { $type: 'EnumBundleElement' as const, name: 'High' },
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueListSchema>

    const result = mapIssueToListItem(issue, 'https://example.com')

    expect(result.id).toBe('PROJ-1')
    expect(result.title).toBe('Test Task')
    expect(result.status).toBe('Open')
    expect(result.priority).toBe('High')
    expect(result.url).toBe('https://example.com/issue/PROJ-1')
  })

  test('extracts number and resolved for list item', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      numberInProject: 42,
      resolved: 1704067200000,
      project: { id: 'proj-1' },
      customFields: [],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueListSchema>

    const result = mapIssueToListItem(issue, 'https://example.com')

    expect(result.number).toBe(42)
    expect(result.resolved).toBe('2024-01-01T00:00:00.000Z')
  })

  test('handles missing optional fields in list item', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      project: { id: 'proj-1' },
      customFields: [],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueListSchema>

    const result = mapIssueToListItem(issue, 'https://example.com')

    expect(result.number).toBeUndefined()
    expect(result.resolved).toBeUndefined()
    expect(result.status).toBeUndefined()
    expect(result.priority).toBeUndefined()
  })
})

describe('mapIssueToSearchResult', () => {
  test('maps search result fields', () => {
    const issue = {
      id: '123',
      idReadable: 'PROJ-1',
      summary: 'Test Task',
      project: { id: 'proj-1', shortName: 'PROJ' },
      customFields: [
        {
          $type: 'SingleEnumIssueCustomField' as const,
          name: 'State',
          value: { $type: 'EnumBundleElement' as const, name: 'Open' },
        },
        {
          $type: 'SingleEnumIssueCustomField' as const,
          name: 'Priority',
          value: { $type: 'EnumBundleElement' as const, name: 'High' },
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueListSchema>

    const result = mapIssueToSearchResult(issue, 'https://example.com')

    expect(result.id).toBe('PROJ-1')
    expect(result.title).toBe('Test Task')
    expect(result.status).toBe('Open')
    expect(result.priority).toBe('High')
    expect(result.projectId).toBe('proj-1')
    expect(result.url).toBe('https://example.com/issue/PROJ-1')
  })

  test('uses id when idReadable missing', () => {
    const issue = {
      id: '123',
      summary: 'Test',
      project: { id: 'proj-1' },
      customFields: [],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/issue.js').IssueListSchema>

    const result = mapIssueToSearchResult(issue, 'https://example.com')

    expect(result.id).toBe('123')
    expect(result.url).toBe('https://example.com/issue/123')
  })
})

describe('mapComment', () => {
  test('maps comment with name', () => {
    const comment = {
      id: 'c-1',
      text: 'This is a comment',
      author: { id: 'u-1', name: 'Alice Smith', login: 'alice' },
      created: 1704067200000,
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/comment.js').CommentSchema>

    const result = mapComment(comment)

    expect(result.id).toBe('c-1')
    expect(result.body).toBe('This is a comment')
    expect(result.author).toBe('Alice Smith')
    expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z')
  })

  test('maps comment with login when name missing', () => {
    const comment = {
      id: 'c-1',
      text: 'Another comment',
      author: { id: 'u-1', login: 'bob' },
      created: 1704153600000,
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/comment.js').CommentSchema>

    const result = mapComment(comment)

    expect(result.author).toBe('bob')
    expect(result.createdAt).toBe('2024-01-02T00:00:00.000Z')
  })

  test('maps reactions with ids', () => {
    const comment = {
      id: 'c-1',
      text: 'With reactions',
      author: { id: 'u-1', login: 'bob' },
      created: 1704153600000,
      reactions: [
        {
          id: 'reaction-1',
          reaction: 'thumbs_up',
          author: {
            id: 'user-1',
            login: 'alice',
            fullName: 'Alice Example',
            email: 'alice@example.com',
          },
        },
      ],
    } satisfies z.infer<typeof import('../../../plugins/task-provider-youtrack/schemas/comment.js').CommentSchema>

    const result = mapComment(comment)

    expect(result.reactions).toEqual([
      {
        id: 'reaction-1',
        reaction: 'thumbs_up',
        author: { id: 'user-1', login: 'alice', name: 'Alice Example' },
        createdAt: undefined,
      },
    ])
  })
})
