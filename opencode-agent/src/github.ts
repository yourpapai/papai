// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Octokit } from '@octokit/rest'

import type { IssueComment } from './state-manager.js'

export interface PullRequestInput {
  head: string
  base: string
  title: string
  body: string
}

export interface PullRequestRef {
  number: number
  url: string
}

/**
 * The narrow GitHub surface the pipeline needs. Everything downstream depends on
 * this interface rather than Octokit, so phase handlers are testable without an
 * HTTP stub layer.
 */
export interface GitHubApi {
  listIssueComments(issueNumber: number): Promise<IssueComment[]>
  createComment(issueNumber: number, body: string): Promise<{ id: number; url: string }>
  getAuthenticatedLogin(): Promise<string>
  findOpenPullRequest(head: string): Promise<PullRequestRef | null>
  createPullRequest(input: PullRequestInput): Promise<PullRequestRef>
}

export interface OctokitApiOptions {
  token: string
  owner: string
  repo: string
  /** Injection seam for tests; defaults to a real Octokit instance. */
  octokit?: Octokit
}

interface Repo {
  owner: string
  repo: string
}

const listIssueComments = async (octokit: Octokit, repo: Repo, issueNumber: number): Promise<IssueComment[]> => {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...repo,
    issue_number: issueNumber,
    per_page: 100,
  })

  return comments.map((comment) => ({
    id: comment.id,
    body: comment.body ?? '',
    authorLogin: comment.user === null ? '' : comment.user.login,
  }))
}

const findOpenPullRequest = async (octokit: Octokit, repo: Repo, head: string): Promise<PullRequestRef | null> => {
  const { data } = await octokit.rest.pulls.list({
    ...repo,
    state: 'open',
    head: `${repo.owner}:${head}`,
    per_page: 1,
  })

  const existing = data[0]
  return existing === undefined ? null : { number: existing.number, url: existing.html_url }
}

/** Builds a {@link GitHubApi} backed by `@octokit/rest`. */
export const createOctokitApi = (options: OctokitApiOptions): GitHubApi => {
  const repo: Repo = { owner: options.owner, repo: options.repo }
  const octokit = options.octokit ?? new Octokit({ auth: options.token })

  return {
    listIssueComments: (issueNumber) => listIssueComments(octokit, repo, issueNumber),
    findOpenPullRequest: (head) => findOpenPullRequest(octokit, repo, head),

    createComment: async (issueNumber, body) => {
      const { data } = await octokit.rest.issues.createComment({
        ...repo,
        issue_number: issueNumber,
        body,
      })
      return { id: data.id, url: data.html_url }
    },

    getAuthenticatedLogin: async () => {
      const { data } = await octokit.rest.users.getAuthenticated()
      return data.login
    },

    createPullRequest: async (input) => {
      const { data } = await octokit.rest.pulls.create({ ...repo, ...input })
      return { number: data.number, url: data.html_url }
    },
  }
}
