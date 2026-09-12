// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { Comment, Label, Task, TaskListItem, TaskSearchResult, Project } from 'papai/plugin-types'

import {
  mapCommentToComment,
  mapIssueLabelToLabel,
  mapIssueToListItem,
  mapIssueToSearchResult,
  mapIssueToTask,
  mapRepoLabelToLabel,
  mapRepoToProject,
} from '../../../plugins/task-provider-github/mappers.js'
import type { GitHubComment } from '../../../plugins/task-provider-github/schemas/comment.js'
import type { GitHubIssue } from '../../../plugins/task-provider-github/schemas/issue.js'
import type { GitHubRepoLabel } from '../../../plugins/task-provider-github/schemas/label.js'
import type { GitHubRepo } from '../../../plugins/task-provider-github/schemas/repo.js'

const user = {
  login: 'octocat',
  id: 583231,
  avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
  html_url: 'https://github.com/octocat',
  type: 'User',
}

const baseIssue: GitHubIssue = {
  id: 1,
  number: 1347,
  title: 'Found a bug',
  body: "I'm having a problem with this.",
  user,
  labels: [],
  assignees: [],
  state: 'open',
  state_reason: null,
  comments: 10,
  created_at: '2011-01-26T19:01:12Z',
  updated_at: '2011-01-26T19:01:12Z',
  closed_at: null,
  milestone: null,
  html_url: 'https://github.com/octocat/Hello-World/issues/1347',
}

describe('mapIssueToTask', () => {
  test('maps an open issue to Task with id = stringified number', () => {
    const task: Task = mapIssueToTask(baseIssue, 'octocat/Hello-World')
    expect(task.id).toBe('1347')
    expect(task.number).toBe(1347)
    expect(task.title).toBe('Found a bug')
    expect(task.status).toBe('open')
  })

  test('assignee is the first assignee login, or null when unassigned', () => {
    const assigned: GitHubIssue = {
      ...baseIssue,
      assignees: [
        { ...user, login: 'hubot' },
        { ...user, login: 'octocat' },
      ],
    }
    expect(mapIssueToTask(assigned, 'octocat/Hello-World').assignee).toBe('hubot')
    expect(mapIssueToTask(baseIssue, 'octocat/Hello-World').assignee).toBeNull()
  })

  test('closed issue folds state_reason completed into plain closed', () => {
    const issue: GitHubIssue = {
      ...baseIssue,
      state: 'closed',
      state_reason: 'completed',
      closed_at: '2011-01-27T10:00:00Z',
    }
    const task = mapIssueToTask(issue, 'octocat/Hello-World')
    expect(task.status).toBe('closed')
    expect(task.resolved).toBe('2011-01-27T10:00:00Z')
  })

  test('closed issue folds state_reason not_planned into "closed (not_planned)"', () => {
    const issue: GitHubIssue = { ...baseIssue, state: 'closed', state_reason: 'not_planned' }
    expect(mapIssueToTask(issue, 'octocat/Hello-World').status).toBe('closed (not_planned)')
  })

  test('closed issue with null state_reason maps to plain closed', () => {
    const issue: GitHubIssue = { ...baseIssue, state: 'closed', state_reason: null }
    expect(mapIssueToTask(issue, 'octocat/Hello-World').status).toBe('closed')
  })

  test('url comes from html_url and projectId from the configured repo', () => {
    const task = mapIssueToTask(baseIssue, 'octocat/Hello-World')
    expect(task.url).toBe('https://github.com/octocat/Hello-World/issues/1347')
    expect(task.projectId).toBe('octocat/Hello-World')
  })

  test('commentsCount, reporter, description, and createdAt carried', () => {
    const task = mapIssueToTask(baseIssue, 'octocat/Hello-World')
    expect(task.commentsCount).toBe(10)
    expect(task.reporter).toEqual({ id: '583231', login: 'octocat' })
    expect(task.description).toBe("I'm having a problem with this.")
    expect(task.createdAt).toBe('2011-01-26T19:01:12Z')
  })

  test('null body maps to null description; ghost author to undefined reporter', () => {
    const issue: GitHubIssue = { ...baseIssue, body: null, user: null }
    const task = mapIssueToTask(issue, 'octocat/Hello-World')
    expect(task.description).toBeNull()
    expect(task.reporter).toBeUndefined()
  })

  test('plain-string labels map to TaskLabel entries', () => {
    const issue: GitHubIssue = { ...baseIssue, labels: ['bug', 'help wanted'] }
    expect(mapIssueToTask(issue, 'octocat/Hello-World').labels).toEqual([
      { id: 'bug', name: 'bug' },
      { id: 'help wanted', name: 'help wanted' },
    ])
  })

  test('object labels map to TaskLabel entries with color', () => {
    const issue: GitHubIssue = {
      ...baseIssue,
      labels: [{ id: 208045946, name: 'bug', color: 'f29513' }],
    }
    expect(mapIssueToTask(issue, 'octocat/Hello-World').labels).toEqual([
      { id: '208045946', name: 'bug', color: 'f29513' },
    ])
  })

  test('PR-marked issues map like plain issues (dropping happens upstream)', () => {
    const issue: GitHubIssue = { ...baseIssue, pull_request: { url: 'https://api.github.com/repos/o/r/pulls/1347' } }
    const task = mapIssueToTask(issue, 'octocat/Hello-World')
    expect(task.id).toBe('1347')
    expect(task.status).toBe('open')
  })
})

describe('mapIssueToListItem', () => {
  test('maps the list-endpoint shape', () => {
    const item: TaskListItem = mapIssueToListItem(baseIssue)
    expect(item).toEqual({
      id: '1347',
      title: 'Found a bug',
      number: 1347,
      status: 'open',
      createdAt: '2011-01-26T19:01:12Z',
      resolved: undefined,
      url: 'https://github.com/octocat/Hello-World/issues/1347',
    })
  })

  test('folds state_reason in list items too', () => {
    const issue: GitHubIssue = { ...baseIssue, state: 'closed', state_reason: 'not_planned' }
    expect(mapIssueToListItem(issue).status).toBe('closed (not_planned)')
  })
})

describe('mapIssueToSearchResult', () => {
  test('maps the search-endpoint shape', () => {
    const result: TaskSearchResult = mapIssueToSearchResult(baseIssue, 'octocat/Hello-World')
    expect(result).toEqual({
      id: '1347',
      title: 'Found a bug',
      number: 1347,
      status: 'open',
      projectId: 'octocat/Hello-World',
      url: 'https://github.com/octocat/Hello-World/issues/1347',
    })
  })
})

describe('mapRepoToProject', () => {
  const repo: GitHubRepo = {
    id: 1296269,
    name: 'Hello-World',
    full_name: 'octocat/Hello-World',
    owner: user,
    html_url: 'https://github.com/octocat/Hello-World',
    private: false,
    description: 'This your first repo!',
  }

  test('id is full_name', () => {
    const project: Project = mapRepoToProject(repo)
    expect(project).toEqual({
      id: 'octocat/Hello-World',
      name: 'Hello-World',
      description: 'This your first repo!',
      url: 'https://github.com/octocat/Hello-World',
    })
  })

  test('null description passes through as null', () => {
    const project = mapRepoToProject({ ...repo, description: null })
    expect(project.description).toBeNull()
  })
})

describe('mapCommentToComment', () => {
  const baseComment: GitHubComment = {
    id: 1,
    body: 'Me too',
    user,
    created_at: '2011-04-14T16:00:49Z',
    updated_at: '2011-04-14T16:00:49Z',
    html_url: 'https://github.com/octocat/Hello-World/issues/1347#issuecomment-1',
    issue_url: 'https://api.github.com/repos/octocat/Hello-World/issues/1347',
    author_association: 'NONE',
  }

  test('maps a GitHub comment to the normalized Comment', () => {
    const comment: Comment = mapCommentToComment(baseComment)
    expect(comment.id).toBe('1')
    expect(comment.body).toBe('Me too')
    expect(comment.author).toBe('octocat')
    expect(comment.createdAt).toBe('2011-04-14T16:00:49Z')
  })

  test('author is undefined when GitHub reports no user (ghost commenter)', () => {
    const comment = mapCommentToComment({ ...baseComment, user: null })
    expect(comment.author).toBeUndefined()
  })
})

describe('mapRepoLabelToLabel', () => {
  test('maps a repo label to Label with stringified id', () => {
    const repoLabel: GitHubRepoLabel = { id: 208045946, name: 'bug', color: 'f29513', description: null }
    const label: Label = mapRepoLabelToLabel(repoLabel)
    expect(label).toEqual({ id: '208045946', name: 'bug', color: 'f29513' })
  })
})

describe('mapIssueLabelToLabel', () => {
  test('string-form issue label maps id to the name', () => {
    const label: Label = mapIssueLabelToLabel('help wanted')
    expect(label).toEqual({ id: 'help wanted', name: 'help wanted' })
  })
})
