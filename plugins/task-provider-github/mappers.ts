// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  Comment,
  Label,
  Project,
  Task,
  TaskListItem,
  TaskSearchResult,
  TaskLabel,
  UserRef,
} from 'papai/plugin-types'

import type { GitHubComment } from './schemas/comment.js'
import type { GitHubIssue, GitHubLabel } from './schemas/issue.js'
import type { GitHubRepoLabel } from './schemas/label.js'
import type { GitHubRepo } from './schemas/repo.js'
import type { GitHubUser } from './schemas/user.js'

/**
 * Status text folds `state_reason` into the status string so the
 * not-planned distinction survives round-trips: `closed (not_planned)` vs
 * plain `closed`; open stays `open`.
 */
const foldStatus = (issue: Pick<GitHubIssue, 'state' | 'state_reason'>): string => {
  if (issue.state === 'open') return 'open'
  return issue.state_reason === 'not_planned' ? 'closed (not_planned)' : 'closed'
}

/** First assignee login, or null when unassigned. */
const firstAssignee = (issue: Pick<GitHubIssue, 'assignees'>): string | null => issue.assignees[0]?.login ?? null

const mapUserRef = (user: GitHubUser | null): UserRef | undefined =>
  user === null ? undefined : { id: String(user.id), login: user.login }

const mapLabel = (label: GitHubLabel): TaskLabel =>
  typeof label === 'string'
    ? { id: label, name: label }
    : { id: String(label.id), name: label.name, color: label.color }

const mapLabels = (labels: readonly GitHubLabel[]): TaskLabel[] | undefined =>
  labels.length === 0 ? undefined : labels.map(mapLabel)

export const mapIssueToTask = (issue: GitHubIssue, repoId: string): Task => ({
  id: String(issue.number),
  title: issue.title,
  description: issue.body,
  status: foldStatus(issue),
  assignee: firstAssignee(issue),
  createdAt: issue.created_at,
  projectId: repoId,
  url: issue.html_url,
  labels: mapLabels(issue.labels),
  number: issue.number,
  reporter: mapUserRef(issue.user),
  commentsCount: issue.comments,
  resolved: issue.closed_at ?? undefined,
})

export const mapIssueToListItem = (issue: GitHubIssue): TaskListItem => ({
  id: String(issue.number),
  title: issue.title,
  number: issue.number,
  status: foldStatus(issue),
  createdAt: issue.created_at,
  resolved: issue.closed_at ?? undefined,
  url: issue.html_url,
})

export const mapIssueToSearchResult = (issue: GitHubIssue, repoId: string): TaskSearchResult => ({
  id: String(issue.number),
  title: issue.title,
  number: issue.number,
  status: foldStatus(issue),
  projectId: repoId,
  url: issue.html_url,
})

export const mapRepoToProject = (repo: GitHubRepo): Project => ({
  id: repo.full_name,
  name: repo.name,
  description: repo.description,
  url: repo.html_url,
})

export const mapCommentToComment = (comment: GitHubComment): Comment => ({
  id: String(comment.id),
  body: comment.body,
  author: comment.user?.login,
  createdAt: comment.created_at,
})

export const mapRepoLabelToLabel = (label: GitHubRepoLabel): Label => ({
  id: String(label.id),
  name: label.name,
  color: label.color,
})

export const mapIssueLabelToLabel = (label: GitHubLabel): Label => mapLabel(label)
