// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Octokit } from '@octokit/rest'

import type { IssueComment } from './blocks.js'
import type { IssueContext } from './phase-context.js'

/**
 * Everything about a pull request that is derived from live issue state, and so
 * has to be re-rendered every time delivery runs — not just the first time.
 *
 * Create and update share this type deliberately. Refreshing a reused pull
 * request used to patch the body alone, which left the title frozen at whatever
 * the issue was called when the branch was first delivered. Tying both calls to
 * one shape means a field added here cannot be wired into `create` and
 * forgotten in `update`; it fails to compile instead.
 */
export interface PullRequestPresentation {
  title: string
  body: string
}

export interface PullRequestInput extends PullRequestPresentation {
  head: string
  base: string
}

export interface PullRequestRef {
  number: number
  url: string
}

/**
 * What became of a branch's pull request.
 *
 * `merged` and `closed` are reported rather than filtered out. Asking only for
 * *open* pull requests made a merged one indistinguishable from one that never
 * existed — the query came back `[]` either way — so a retry after a merge
 * opened a second pull request from the fully-merged branch.
 */
export type PullRequestState = 'open' | 'merged' | 'closed'

export interface PullRequestStatus extends PullRequestRef {
  state: PullRequestState
}

/**
 * The narrow GitHub surface the pipeline needs. Everything downstream depends on
 * this interface rather than Octokit, so phase handlers are testable without an
 * HTTP stub layer.
 */
export interface GitHubApi {
  listIssueComments(issueNumber: number): Promise<IssueComment[]>
  createComment(issueNumber: number, body: string): Promise<{ id: number; url: string }>
  getIssue(issueNumber: number): Promise<IssueContext>
  getAuthenticatedLogin(): Promise<string>
  /** The newest pull request from `head`, whatever became of it. */
  findPullRequest(head: string): Promise<PullRequestStatus | null>
  createPullRequest(input: PullRequestInput): Promise<PullRequestRef>
  updatePullRequest(number: number, patch: PullRequestPresentation): Promise<void>
}

export interface OctokitApiOptions {
  token: string
  owner: string
  repo: string
  /**
   * Transport seam. Tests pass a recorder so they can assert what actually goes
   * over the wire without opening a socket — this is the one layer where a
   * dropped field is invisible to the phase tests, which only see what the
   * pipeline asked for.
   */
  fetch?: FetchLike
}

/**
 * The slice of `fetch` this adapter uses. Narrower than the runtime's global
 * type, which carries Bun-only members a test recorder has no reason to supply;
 * `@octokit/request` only ever calls it with a URL string.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

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

const findPullRequest = async (octokit: Octokit, repo: Repo, head: string): Promise<PullRequestStatus | null> => {
  const { data } = await octokit.rest.pulls.list({
    ...repo,
    state: 'all',
    head: `${repo.owner}:${head}`,
    sort: 'created',
    direction: 'desc',
    per_page: 1,
  })

  const existing = data[0]
  if (existing === undefined) return null

  return {
    number: existing.number,
    url: existing.html_url,
    // `merged_at` rather than `merged`: the list endpoint carries the timestamp
    // but not the boolean, which only the single-pull-request endpoint returns.
    state: existing.merged_at === null ? closedOrOpen(existing.state) : 'merged',
  }
}

const closedOrOpen = (state: string): PullRequestState => (state === 'open' ? 'open' : 'closed')

/** Builds a {@link GitHubApi} backed by `@octokit/rest`. */
export const createOctokitApi = (options: OctokitApiOptions): GitHubApi => {
  const repo: Repo = { owner: options.owner, repo: options.repo }
  // An undefined `fetch` falls through to `globalThis.fetch` inside
  // `@octokit/request`, so the production path is unchanged.
  const octokit = new Octokit({ auth: options.token, request: { fetch: options.fetch } })

  return {
    listIssueComments: (issueNumber) => listIssueComments(octokit, repo, issueNumber),
    findPullRequest: (head) => findPullRequest(octokit, repo, head),

    createComment: async (issueNumber, body) => {
      const { data } = await octokit.rest.issues.createComment({
        ...repo,
        issue_number: issueNumber,
        body,
      })
      return { id: data.id, url: data.html_url }
    },

    getIssue: async (issueNumber) => {
      const { data } = await octokit.rest.issues.get({ ...repo, issue_number: issueNumber })
      return { number: data.number, title: data.title, body: data.body ?? '' }
    },

    updatePullRequest: async (number, patch) => {
      await octokit.rest.pulls.update({ ...repo, pull_number: number, ...patch })
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
