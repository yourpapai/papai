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
 * The narrow GitHub surface the pipeline needs. Everything downstream depends on
 * this interface rather than Octokit, so phase handlers are testable without an
 * HTTP stub layer.
 */
export interface GitHubApi {
  listIssueComments(issueNumber: number): Promise<IssueComment[]>
  createComment(issueNumber: number, body: string): Promise<{ id: number; url: string }>
  getIssue(issueNumber: number): Promise<IssueContext>
  getAuthenticatedLogin(): Promise<string>
  findOpenPullRequest(head: string): Promise<PullRequestRef | null>
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
  // An undefined `fetch` falls through to `globalThis.fetch` inside
  // `@octokit/request`, so the production path is unchanged.
  const octokit = new Octokit({ auth: options.token, request: { fetch: options.fetch } })

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
