// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  GitHubIssueEventSchema,
  type GitHubIssueEvent,
} from '../../../../plugins/task-provider-github/schemas/event.js'
import { schemaValidates } from '../../../utils/test-helpers.js'

describe('GitHubIssueEventSchema', () => {
  const octocat = {
    login: 'octocat',
    id: 583231,
    avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
    html_url: 'https://github.com/octocat',
    type: 'User',
    site_admin: false,
    node_id: 'MDQ6VXNlcjU4MzIzMQ==',
  }

  const assignedEvent = {
    id: 1,
    node_id: 'MDE1OkV2ZW50MTM5MTY2NjU0',
    url: 'https://api.github.com/repos/octocat/Hello-World/issues/events/1',
    actor: octocat,
    event: 'assigned',
    commit_id: null,
    commit_url: null,
    created_at: '2011-04-14T16:00:49Z',
    assignee: {
      login: 'hubot',
      id: 1,
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      html_url: 'https://github.com/hubot',
      type: 'Bot',
    },
    performed_via_github_app: null,
  }

  const labeledEvent = {
    id: 2,
    node_id: 'MDE1OkV2ZW50MTIwODA0NTk0Ng==',
    url: 'https://api.github.com/repos/octocat/Hello-World/issues/events/2',
    actor: octocat,
    event: 'labeled',
    commit_id: null,
    commit_url: null,
    created_at: '2011-04-15T10:30:00Z',
    label: {
      id: 208045946,
      node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
      url: 'https://api.github.com/repos/octocat/Hello-World/labels/bug',
      name: 'bug',
      color: 'f29513',
      default: true,
    },
    performed_via_github_app: null,
  }

  const closedEvent = {
    id: 3,
    node_id: 'MDE1OkV2ZW50MTM5MTY2NjU5',
    url: 'https://api.github.com/repos/octocat/Hello-World/issues/events/3',
    actor: octocat,
    event: 'closed',
    commit_id: '6dcb09b5b57875f334f61aebed695e2e4193db5e',
    commit_url: 'https://api.github.com/repos/octocat/Hello-World/commits/6dcb09b5b57875f334f61aebed695e2e4193db5e',
    created_at: '2011-04-16T09:12:00Z',
    performed_via_github_app: null,
  }

  const rejects = (data: unknown): void => {
    expect(schemaValidates({ inputSchema: GitHubIssueEventSchema }, data)).toBe(false)
  }

  test('accepts a representative assigned payload and exports inferred type', () => {
    const parsed: GitHubIssueEvent = GitHubIssueEventSchema.parse(assignedEvent)
    expect(parsed.id).toBe(1)
    expect(parsed.event).toBe('assigned')
    expect(parsed.created_at).toBe('2011-04-14T16:00:49Z')
    expect(parsed.actor?.login).toBe('octocat')
    expect(parsed.assignee?.login).toBe('hubot')
  })

  test('accepts a representative labeled payload', () => {
    const parsed = GitHubIssueEventSchema.parse(labeledEvent)
    expect(parsed.event).toBe('labeled')
    expect(parsed.label?.name).toBe('bug')
  })

  test('accepts a representative closed payload without assignee/label keys', () => {
    const parsed = GitHubIssueEventSchema.parse(closedEvent)
    expect(parsed.event).toBe('closed')
    expect(parsed.assignee).toBeUndefined()
    expect(parsed.label).toBeUndefined()
  })

  test('actor as null accepts (ghost actor)', () => {
    expect(GitHubIssueEventSchema.parse({ ...closedEvent, actor: null }).actor).toBeNull()
  })

  test('assignee as null accepts', () => {
    expect(GitHubIssueEventSchema.parse({ ...assignedEvent, assignee: null }).assignee).toBeNull()
  })

  test('label as null accepts', () => {
    expect(GitHubIssueEventSchema.parse({ ...labeledEvent, label: null }).label).toBeNull()
  })

  test('extra GitHub event fields stripped', () => {
    const result = GitHubIssueEventSchema.parse(assignedEvent)
    expect('node_id' in result).toBe(false)
    expect('url' in result).toBe(false)
    expect('commit_id' in result).toBe(false)
    expect('commit_url' in result).toBe(false)
    expect('performed_via_github_app' in result).toBe(false)
  })

  test('extra nested actor fields stripped', () => {
    const result = GitHubIssueEventSchema.parse(assignedEvent)
    expect(result.actor).toEqual({
      login: 'octocat',
      id: 583231,
      avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
    })
  })

  test('missing id rejects', () => {
    const { id: _, ...invalid } = assignedEvent
    rejects(invalid)
  })

  test('id as string rejects', () => {
    rejects({ ...assignedEvent, id: '1' })
  })

  test('id as non-integer number rejects', () => {
    rejects({ ...assignedEvent, id: 1.5 })
  })

  test('missing event rejects', () => {
    const { event: _, ...invalid } = closedEvent
    rejects(invalid)
  })

  test('event as number rejects', () => {
    rejects({ ...closedEvent, event: 7 })
  })

  test('missing created_at rejects', () => {
    const { created_at: _, ...invalid } = closedEvent
    rejects(invalid)
  })

  test('missing actor key rejects', () => {
    const { actor: _, ...invalid } = closedEvent
    rejects(invalid)
  })

  test('actor as string rejects', () => {
    rejects({ ...closedEvent, actor: 'octocat' })
  })

  test('actor missing login rejects', () => {
    const { login: _, ...badUser } = octocat
    rejects({ ...closedEvent, actor: badUser })
  })

  test('assignee as string rejects', () => {
    rejects({ ...assignedEvent, assignee: 'hubot' })
  })

  test('label as string rejects', () => {
    rejects({ ...labeledEvent, label: 'bug' })
  })

  test('label missing name rejects', () => {
    const { name: _, ...badLabel } = labeledEvent.label
    rejects({ ...labeledEvent, label: badLabel })
  })
})
