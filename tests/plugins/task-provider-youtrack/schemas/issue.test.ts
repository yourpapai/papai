// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/issue.test.ts
import { describe, expect, test } from 'bun:test'

import { IssueSchema, IssueListSchema } from '../../../../plugins/task-provider-youtrack/schemas/issue.js'

describe('Issue schemas', () => {
  const validIssue = {
    id: '0-0',
    $type: 'Issue',
    idReadable: 'PROJ-123',
    summary: 'Test Issue',
    description: 'Description text',
    created: 1700000000000,
    updated: 1700000000001,
    project: { id: '0-0', $type: 'Project' },
    customFields: [],
    tags: [],
  }

  describe('IssueSchema', () => {
    test('reporter/updater as null accept (YouTrack returns null for unset/deleted users)', () => {
      const result = IssueSchema.parse({ ...validIssue, reporter: null, updater: null })
      expect(result.reporter).toBeNull()
      expect(result.updater).toBeNull()
    })

    test('watcher user with null email/fullName accepts', () => {
      const result = IssueSchema.parse({
        ...validIssue,
        watchers: {
          hasStar: false,
          issueWatchers: [{ isStarred: false, user: { id: 'u', login: 'svc', email: null, fullName: null } }],
        },
      })
      expect(result.watchers?.issueWatchers?.[0]?.user.email).toBeNull()
    })

    test('validates full issue', () => {
      const result = IssueSchema.parse({
        ...validIssue,
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
          ],
        },
        visibility: {
          $type: 'LimitedVisibility',
          permittedUsers: [{ id: 'user-1', login: 'alice', fullName: 'Alice Example' }],
          permittedGroups: [{ id: 'group-1', name: 'Team Alpha' }],
        },
      })
      expect(result.idReadable).toBe('PROJ-123')
      expect(result.summary).toBe('Test Issue')
      expect(result.watchers?.issueWatchers?.[0]?.user.login).toBe('alice')
      expect(result.visibility?.$type).toBe('LimitedVisibility')
    })

    test('missing idReadable rejects', () => {
      const { idReadable: _, ...invalid } = validIssue
      expect(() => IssueSchema.parse(invalid)).toThrow()
    })

    test('missing summary rejects', () => {
      const { summary: _, ...invalid } = validIssue
      expect(() => IssueSchema.parse(invalid)).toThrow()
    })

    test('missing project rejects', () => {
      const { project: _, ...invalid } = validIssue
      expect(() => IssueSchema.parse(invalid)).toThrow()
    })

    test('missing created rejects', () => {
      const { created: _, ...invalid } = validIssue
      expect(() => IssueSchema.parse(invalid)).toThrow()
    })

    test('missing updated rejects', () => {
      const { updated: _, ...invalid } = validIssue
      expect(() => IssueSchema.parse(invalid)).toThrow()
    })

    test('missing customFields rejects', () => {
      const { customFields: _, ...invalid } = validIssue
      expect(() => IssueSchema.parse(invalid)).toThrow()
    })

    test('project missing id rejects', () => {
      expect(() => IssueSchema.parse({ ...validIssue, project: { name: 'P' } })).toThrow()
    })

    test('customFields as empty array accepts', () => {
      const result = IssueSchema.parse({ ...validIssue, customFields: [] })
      expect(result.customFields).toEqual([])
    })

    test('tags as empty array accepts', () => {
      const result = IssueSchema.parse(validIssue)
      expect(result.tags).toEqual([])
    })

    test('links as empty array accepts', () => {
      const result = IssueSchema.parse({ ...validIssue, links: [] })
      expect(result.links).toEqual([])
    })

    test('commentsCount as string rejects', () => {
      expect(() => IssueSchema.parse({ ...validIssue, commentsCount: 'five' })).toThrow()
    })

    test('resolved as null accepts (nullable, results in null)', () => {
      const result = IssueSchema.parse({ ...validIssue, resolved: null })
      expect(result.resolved).toBeNull()
    })

    test('description as null accepts (nullable, results in null)', () => {
      const result = IssueSchema.parse({ ...validIssue, description: null })
      expect(result.description).toBeNull()
    })

    test('minimal valid issue', () => {
      const minimal = {
        id: '1',
        idReadable: 'P-1',
        summary: 'S',
        created: 1,
        updated: 2,
        project: { id: 'p1' },
        customFields: [],
      }
      expect(() => IssueSchema.parse(minimal)).not.toThrow()
    })

    test('accepts unlimited visibility', () => {
      const result = IssueSchema.parse({
        ...validIssue,
        visibility: { $type: 'UnlimitedVisibility' },
      })

      expect(result.visibility?.$type).toBe('UnlimitedVisibility')
    })
  })

  describe('IssueListSchema', () => {
    test('valid list item', () => {
      const result = IssueListSchema.parse({ id: '1', summary: 'x' })
      expect(result.id).toBe('1')
      expect(result.summary).toBe('x')
    })

    test('missing id rejects', () => {
      expect(() => IssueListSchema.parse({ summary: 'x' })).toThrow()
    })

    test('missing summary rejects', () => {
      expect(() => IssueListSchema.parse({ id: '1' })).toThrow()
    })

    test('idReadable omitted accepts', () => {
      const result = IssueListSchema.parse({ id: '1', summary: 'x' })
      expect(result.idReadable).toBeUndefined()
    })

    test('project omitted accepts', () => {
      const result = IssueListSchema.parse({ id: '1', summary: 'x' })
      expect(result.project).toBeUndefined()
    })

    test('customFields omitted accepts', () => {
      const result = IssueListSchema.parse({ id: '1', summary: 'x' })
      expect(result.customFields).toBeUndefined()
    })

    test('full list item with all optionals', () => {
      const full = {
        id: '1',
        $type: 'Issue',
        idReadable: 'P-1',
        summary: 'Task',
        project: { id: 'p1', name: 'Project', shortName: 'P' },
        customFields: [
          {
            $type: 'SimpleIssueCustomField' as const,
            name: 'Field',
            value: 'val',
          },
        ],
      }
      const result = IssueListSchema.parse(full)
      expect(result.idReadable).toBe('P-1')
      expect(result.project?.name).toBe('Project')
      expect(result.customFields).toHaveLength(1)
    })

    test('resolved as null accepts (nullable for unresolved issues)', () => {
      const result = IssueListSchema.parse({ id: '1', summary: 'x', resolved: null })
      expect(result.resolved).toBeNull()
    })

    test('resolved as number accepts', () => {
      const result = IssueListSchema.parse({ id: '1', summary: 'x', resolved: 1700000000000 })
      expect(result.resolved).toBe(1700000000000)
    })
  })
})
