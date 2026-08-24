// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * A stateful in-memory fake GitHub REST API. It models exactly the request
 * shapes the GitHub provider builds (plugins/task-provider-github) and the
 * response shapes its Zod schemas parse. It is NOT a fidelity model of real
 * GitHub — both this fake and the stories are authored here, so this lane
 * proves request-building + response-mapping + contract conformance, never
 * drift against live GitHub.
 */

export const FAKE_GITHUB_OWNER = 'acme'
export const FAKE_GITHUB_REPO = 'papai'
export const FAKE_GITHUB_USER_LOGIN = 'octocat'

const FIXED_TIMESTAMP = '2026-01-01T00:00:00Z'

export type StoredIssue = {
  id: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labelNames: string[]
  createdAt: string
  updatedAt: string
}

export type StoredComment = {
  id: number
  issueNumber: number
  body: string
  createdAt: string
  updatedAt: string
}

export type StoredLabel = {
  id: number
  name: string
  color: string
  description: string | null
}

export type FakeGitHubState = Readonly<{
  readonly issues: ReadonlyMap<number, StoredIssue>
  readonly labels: ReadonlyMap<number, StoredLabel>
  createIssue(input: Readonly<{ title: string; body: string | null }>): StoredIssue
  issueComments(issueNumber: number): StoredComment[]
  createComment(issueNumber: number, body: string): StoredComment
  updateComment(commentId: number, body: string): StoredComment | undefined
  deleteComment(commentId: number): boolean
  createLabel(input: Readonly<{ name: string; color: string; description: string | null }>): StoredLabel
  updateLabel(
    name: string,
    input: Readonly<{ newName?: string; color?: string }>,
  ): { renamed: boolean; label: StoredLabel | undefined }
  deleteLabel(name: string): boolean
  setIssueLabels(issueNumber: number, names: readonly string[]): void
  addIssueLabels(issueNumber: number, names: readonly string[]): void
  removeIssueLabel(issueNumber: number, name: string): boolean
  labelByName(name: string): StoredLabel | undefined
}>

export function createFakeGitHubState(): FakeGitHubState {
  const issues = new Map<number, StoredIssue>()
  const comments = new Map<number, StoredComment>()
  const labels = new Map<number, StoredLabel>()
  let nextIssueId = 1000
  let nextIssueNumber = 0
  let nextCommentId = 9000
  let nextLabelId = 5000

  const insertIssue = (title: string, body: string | null): StoredIssue => {
    nextIssueId += 1
    nextIssueNumber += 1
    const issue: StoredIssue = {
      id: nextIssueId,
      number: nextIssueNumber,
      title,
      body,
      state: 'open',
      labelNames: [],
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    }
    issues.set(issue.number, issue)
    return issue
  }

  // The provider offers no task-creation capability (one instance = one
  // repository; issue creation is not part of the session-1/2 surface), so
  // every scenario starts against a repository that already has one issue.
  insertIssue('Ship it', null)

  const requireIssue = (issueNumber: number): StoredIssue => {
    const issue = issues.get(issueNumber)
    if (issue === undefined) throw new Error(`No such issue #${issueNumber}`)
    return issue
  }

  const relabelIssues = (previousName: string, nextName: string): void => {
    for (const issue of issues.values()) {
      issue.labelNames = issue.labelNames.map((name) => (name === previousName ? nextName : name))
    }
  }

  return {
    issues,
    labels,
    createIssue({ title, body }): StoredIssue {
      return insertIssue(title, body)
    },
    issueComments(issueNumber: number): StoredComment[] {
      return [...comments.values()].filter((comment) => comment.issueNumber === issueNumber)
    },
    createComment(issueNumber, body): StoredComment {
      requireIssue(issueNumber)
      nextCommentId += 1
      const comment: StoredComment = {
        id: nextCommentId,
        issueNumber,
        body,
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
      }
      comments.set(comment.id, comment)
      return comment
    },
    updateComment(commentId, body): StoredComment | undefined {
      const comment = comments.get(commentId)
      if (comment === undefined) return undefined
      comment.body = body
      comment.updatedAt = FIXED_TIMESTAMP
      return comment
    },
    deleteComment(commentId: number): boolean {
      return comments.delete(commentId)
    },
    createLabel({ name, color, description }): StoredLabel {
      nextLabelId += 1
      const label: StoredLabel = { id: nextLabelId, name, color, description }
      labels.set(label.id, label)
      return label
    },
    updateLabel(name, { newName, color }) {
      const existing = [...labels.values()].find((label) => label.name === name)
      if (existing === undefined) return { renamed: false, label: undefined }
      if (newName !== undefined && newName !== name) {
        relabelIssues(name, newName)
        existing.name = newName
      }
      if (color !== undefined) existing.color = color
      return { renamed: true, label: existing }
    },
    deleteLabel(name: string): boolean {
      for (const [id, label] of labels.entries()) {
        if (label.name !== name) continue
        labels.delete(id)
        for (const issue of issues.values()) {
          issue.labelNames = issue.labelNames.filter((issueLabelName) => issueLabelName !== name)
        }
        return true
      }
      return false
    },
    setIssueLabels(issueNumber, names): void {
      requireIssue(issueNumber).labelNames = [...names]
    },
    addIssueLabels(issueNumber, names): void {
      const issue = requireIssue(issueNumber)
      for (const name of names) {
        if (!issue.labelNames.includes(name)) issue.labelNames.push(name)
      }
    },
    removeIssueLabel(issueNumber, name): boolean {
      const issue = requireIssue(issueNumber)
      const before = issue.labelNames.length
      issue.labelNames = issue.labelNames.filter((issueLabelName) => issueLabelName !== name)
      return issue.labelNames.length < before
    },
    labelByName(name: string): StoredLabel | undefined {
      return [...labels.values()].find((label) => label.name === name)
    },
  }
}
