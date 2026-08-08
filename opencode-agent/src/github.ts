// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Octokit } from '@octokit/rest'

import type { IssueComment } from './blocks.js'
import { createLabelEndpoints } from './github-labels.js'
import type { LabelApi } from './github-labels.js'
import type { IssueContext } from './phase-context.js'
import { redactSecrets } from './secrets.js'

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

export interface PostedComment {
  id: number
  url: string
  /** Who GitHub says wrote it — the only free, authoritative identity check. */
  authorLogin: string
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
 * The reactions this pipeline places, as a closed union rather than free text.
 *
 * That closure is what exempts it from `clean`. Outbound redaction exists
 * because a comment body is assembled from check output, git stderr, review
 * summaries and model prose, and any of those can carry a credential; a value
 * drawn from four literals the pipeline picks itself has nowhere for one to
 * hide. It is the same exemption the `head`/`base` branch names take in
 * {@link PullRequestInput} — computed here, so passed through untouched — and it
 * is stated rather than implied, because "a new `GitHubApi` method that sends
 * free text must redact it" is a rule a silent exception erodes.
 */
export type ReactionContent = 'eyes' | '+1' | 'confused' | 'rocket'

/**
 * What a reaction lands on.
 *
 * One discriminated shape rather than an `addIssueReaction` and an
 * `addCommentReaction`: the two REST endpoints differ only in the path segment
 * they address — `issues/{n}/reactions` against `issues/comments/{id}/reactions`
 * — and the callers all hold one id or the other without caring which endpoint
 * that makes it. Two methods would put that mapping in every call site.
 */
export type ReactionTarget = { kind: 'issue'; number: number } | { kind: 'comment'; id: number }

/**
 * The narrow GitHub surface the pipeline needs. Everything downstream depends on
 * this interface rather than Octokit, so phase handlers are testable without an
 * HTTP stub layer.
 *
 * The label endpoints arrive through {@link LabelApi} rather than being written
 * out again here: extending it is what keeps a fake that satisfies `GitHubApi`
 * unable to leave one of them out, which is the property the whole interface
 * exists for.
 */
export interface GitHubApi extends LabelApi {
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
  /** The newest pull request from `head`, whatever became of it. */
  findPullRequest(head: string): Promise<PullRequestStatus | null>
  createPullRequest(input: PullRequestInput): Promise<PullRequestRef>
  updatePullRequest(number: number, patch: PullRequestPresentation): Promise<void>
  /**
   * Places one reaction. Rejects like any other call — `feedback.ts` owns the
   * rule that a rejection here can never fail a run, because that is a decision
   * about the pipeline, not about the transport.
   *
   * Idempotent server-side: a repeated reaction returns the existing one, so no
   * caller has to record what it has already placed.
   */
  addReaction(target: ReactionTarget, content: ReactionContent): Promise<void>
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

/** The free-text half of a pull request, redacted. `head`/`base` are branch
 * names this pipeline computes, so they are left exactly as given. */
const presentable = (
  presentation: PullRequestPresentation,
  clean: (text: string) => string,
): PullRequestPresentation => ({
  title: clean(presentation.title),
  body: clean(presentation.body),
})

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

/** Routes to whichever of the two reaction endpoints the target names. */
const addReaction = async (
  octokit: Octokit,
  repo: Repo,
  target: ReactionTarget,
  content: ReactionContent,
): Promise<void> => {
  if (target.kind === 'comment') {
    await octokit.rest.reactions.createForIssueComment({ ...repo, comment_id: target.id, content })
    return
  }
  await octokit.rest.reactions.createForIssue({ ...repo, issue_number: target.number, content })
}

/** Builds a {@link GitHubApi} backed by `@octokit/rest`. */
export const createOctokitApi = (options: OctokitApiOptions): GitHubApi => {
  const repo: Repo = { owner: options.owner, repo: options.repo }
  const clean = (text: string): string => redactSecrets(text, options.secrets)
  // An undefined `fetch` falls through to `globalThis.fetch` inside
  // `@octokit/request`, so the production path is unchanged.
  const octokit = new Octokit({ auth: options.token, request: { fetch: options.fetch } })

  return {
    listIssueComments: (issueNumber) => listIssueComments(octokit, repo, issueNumber),
    findPullRequest: (head) => findPullRequest(octokit, repo, head),
    // No `clean`: the content is a member of a four-value union this pipeline
    // picks, exactly like the `head`/`base` branch names above.
    addReaction: (target, content) => addReaction(octokit, repo, target, content),
    // Nor here, and for the same reason — a label name is this pipeline's own
    // prefix followed by a suffix from a closed table. See `github-labels.ts`.
    ...createLabelEndpoints(octokit, repo),

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

    updatePullRequest: async (number, patch) => {
      await octokit.rest.pulls.update({ ...repo, pull_number: number, ...presentable(patch, clean) })
    },

    getAuthenticatedLogin: async () => {
      const { data } = await octokit.rest.users.getAuthenticated()
      return data.login
    },

    createPullRequest: async (input) => {
      const { data } = await octokit.rest.pulls.create({ ...repo, ...input, ...presentable(input, clean) })
      return { number: data.number, url: data.html_url }
    },
  }
}
