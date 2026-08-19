// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Octokit } from '@octokit/rest'

import type { IssueComment } from './blocks.js'
import { createLabelEndpoints } from './github-labels.js'
import type { LabelApi } from './github-labels.js'
import { createPullRequestEndpoints } from './github-pulls.js'
import type { PullRequestApi } from './github-pulls.js'
import { createReactionEndpoints } from './github-reactions.js'
import type { ReactionApi } from './github-reactions.js'
import type { IssueContext } from './phase-context.js'
import { redactSecrets } from './secrets.js'

export interface PostedComment {
  id: number
  url: string
  /** Who GitHub says wrote it — the only free, authoritative identity check. */
  authorLogin: string
}

/**
 * The narrow GitHub surface the pipeline needs. Everything downstream depends on
 * this interface rather than Octokit, so phase handlers are testable without an
 * HTTP stub layer.
 *
 * The label, reaction and pull-request endpoints arrive through `LabelApi`,
 * `ReactionApi` and `PullRequestApi` rather than being written out again here:
 * extending them is what keeps a fake that satisfies `GitHubApi` unable to leave
 * one of them out, which is the property the whole interface exists for.
 */
export interface GitHubUser {
  login: string
  id: number
}

export interface GitHubApi extends LabelApi, PullRequestApi, ReactionApi {
  listIssueComments(issueNumber: number): Promise<IssueComment[]>
  /** Returns the created comment, including the author GitHub recorded. */
  createComment(issueNumber: number, body: string): Promise<PostedComment>
  /**
   * Rewrites a comment this pipeline already posted.
   *
   * The second method that carries free text, and so the second that must be
   * redacted — the rule is that a new `GitHubApi` method sending free text
   * passes through `clean`, and this one carries a live status body assembled
   * from the same activity summaries and state fields a comment is. It takes no
   * exemption: unlike a reaction content or a label name, nothing here is drawn
   * from a closed table the pipeline picks from.
   *
   * Two callers, both best-effort one layer up: `status-reporter.ts` edits the
   * run's live status, and `state-persist.ts` rewrites a state block without
   * posting. Neither rule lives here — this is the transport.
   */
  updateComment(commentId: number, body: string): Promise<void>
  getIssue(issueNumber: number): Promise<IssueContext>
  getAuthenticatedLogin(): Promise<string>
  getUser(login: string): Promise<GitHubUser>
}

export interface OctokitApiOptions {
  token: string
  owner: string
  repo: string
  /**
   * Credential values stripped from every outbound body.
   *
   * Required rather than optional so a new construction site has to decide.
   * Redaction lives here, at the boundary, instead of in the renderers: a
   * comment body is assembled from check output, git stderr, review summaries
   * and model prose, and each of those is a place a future renderer could
   * forget. Nothing leaves this module without passing through it.
   */
  secrets: readonly string[]
  /**
   * Transport seam. Tests pass a recorder so they can assert what actually goes
   * over the wire without opening a socket — this is the one layer where a
   * dropped field is invisible to the phase tests, which only see what the
   * pipeline asked for.
   */
  fetch?: FetchLike
  /**
   * Octokit's own logger.
   *
   * `@octokit/plugin-request-log` narrates every request through it, and a
   * rejected call lands on `error`, which Octokit defaults to `console.error`.
   * That default is deliberate in production and untouched when this is
   * omitted; a test that drives a refusal on purpose hands in a sink so the
   * expected 403 does not read as a real diagnostic in the test log.
   */
  log?: OctokitLog
}

/** The four levels Octokit's logger carries, all of which it requires. */
export interface OctokitLog {
  debug: (message: string) => unknown
  info: (message: string) => unknown
  warn: (message: string) => unknown
  error: (message: string) => unknown
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

/** Builds a {@link GitHubApi} backed by `@octokit/rest`. */
export const createOctokitApi = (options: OctokitApiOptions): GitHubApi => {
  const repo: Repo = { owner: options.owner, repo: options.repo }
  const clean = (text: string): string => redactSecrets(text, options.secrets)
  // An undefined `fetch` falls through to `globalThis.fetch` inside
  // `@octokit/request`, so the production path is unchanged.
  // An undefined `log` falls through to Octokit's own default logger, so the
  // production path is unchanged there too.
  const octokit = new Octokit({ auth: options.token, log: options.log, request: { fetch: options.fetch } })

  return {
    listIssueComments: (issueNumber) => listIssueComments(octokit, repo, issueNumber),
    // No `clean` on either family: a reaction content and a label name are both
    // drawn from closed tables this pipeline owns, exactly like the `head`/`base`
    // branch names `github-pulls.ts` passes through untouched. Stated at each
    // module — `github-reactions.ts`, `github-labels.ts` — rather than only here.
    ...createReactionEndpoints(octokit, repo),
    ...createLabelEndpoints(octokit, repo),
    // The pull-request family does carry free text, so it is handed `clean`
    // rather than exempted from it. See `github-pulls.ts`.
    ...createPullRequestEndpoints(octokit, repo, clean),

    createComment: async (issueNumber, body) => {
      const { data } = await octokit.rest.issues.createComment({
        ...repo,
        issue_number: issueNumber,
        body: clean(body),
      })
      return { id: data.id, url: data.html_url, authorLogin: data.user?.login ?? '' }
    },

    updateComment: async (commentId, body) => {
      await octokit.rest.issues.updateComment({ ...repo, comment_id: commentId, body: clean(body) })
    },

    getIssue: async (issueNumber) => {
      const { data } = await octokit.rest.issues.get({ ...repo, issue_number: issueNumber })
      return { number: data.number, title: data.title, body: data.body ?? '' }
    },

    getAuthenticatedLogin: async () => {
      const { data } = await octokit.rest.users.getAuthenticated()
      return data.login
    },

    getUser: async (login) => {
      const { data } = await octokit.rest.users.getByUsername({ username: login })
      return { login: data.login, id: data.id }
    },
  }
}
