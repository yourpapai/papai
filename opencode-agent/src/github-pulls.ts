// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Octokit } from '@octokit/rest'

/**
 * The pull-request half of the GitHub surface.
 *
 * Split out of `github.ts` when {@link PullRequestApi.getPullRequestHead} pushed
 * that file past `max-lines`, along the same seam `github-labels.ts` was cut on:
 * one endpoint family, with a vocabulary of its own that no other call in this
 * pipeline shares — a branch, a base, a title, a body, and what became of the
 * thing. Nothing here is best-effort either; whether a rejected `updatePullRequest`
 * is fatal depends entirely on which phase asked, and that decision lives in the
 * phase (fatal in `handleDeliver`, swallowed in `phases/review.ts`).
 *
 * Unlike the label endpoints, these carry free text, so the redaction
 * `github.ts` applies at its boundary is handed in rather than skipped — see
 * {@link createPullRequestEndpoints}.
 */

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
 * Where a pull request's changes come from, and what became of it.
 *
 * Read by `pr-trigger.ts` for one job: a comment typed on a pull request names
 * no issue, and `ref` — `agent/issue-<n>` — is the only link back to the
 * conversation that started the work. Which is exactly why `repoFullName` rides
 * along and is not optional: `ref` is **attacker-controlled**, since a fork's
 * branch name reaches this endpoint verbatim, so the name of the repository that
 * branch lives in is the only field that can tell the agent's own branch from a
 * fork's impersonation of one.
 */
export interface PullRequestHead {
  ref: string
  /** `owner/repo` of the head repository; empty when it has been deleted. */
  repoFullName: string
  state: PullRequestState
}

export interface PullRequestApi {
  /** The newest pull request from `head`, whatever became of it. */
  findPullRequest(head: string): Promise<PullRequestStatus | null>
  /**
   * The branch one pull request merges from, and the repository that branch is
   * in. The inverse lookup of {@link PullRequestApi.findPullRequest}, and the
   * only way a comment typed on a pull request finds its issue.
   */
  getPullRequestHead(prNumber: number): Promise<PullRequestHead>
  createPullRequest(input: PullRequestInput): Promise<PullRequestRef>
  updatePullRequest(number: number, patch: PullRequestPresentation): Promise<void>
}

/**
 * The owner/repo pair every endpoint is scoped to.
 *
 * Declared here and structurally identical to `github.ts`'s own, so that file
 * can pass its `Repo` straight through without either module importing a type
 * from the other — which for a file split out of the one that calls it is how an
 * import cycle starts.
 */
interface RepoRef {
  owner: string
  repo: string
}

/**
 * The free-text half of a pull request, redacted. `head`/`base` are branch names
 * this pipeline computes, so they are left exactly as given.
 */
const presentable = (
  presentation: PullRequestPresentation,
  clean: (text: string) => string,
): PullRequestPresentation => ({
  title: clean(presentation.title),
  body: clean(presentation.body),
})

const closedOrOpen = (state: string): PullRequestState => (state === 'open' ? 'open' : 'closed')

const findPullRequest = async (octokit: Octokit, repo: RepoRef, head: string): Promise<PullRequestStatus | null> => {
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

const getPullRequestHead = async (octokit: Octokit, repo: RepoRef, prNumber: number): Promise<PullRequestHead> => {
  const { data } = await octokit.rest.pulls.get({ ...repo, pull_number: prNumber })

  return {
    ref: data.head.ref,
    // Empty when the head repository has been deleted, which a fork's routinely
    // is. Empty is the right answer rather than a throw: the caller compares
    // this against this repository's name, and a name that is not there loses
    // that comparison — precisely the verdict a vanished fork deserves.
    repoFullName: data.head.repo?.full_name ?? '',
    // Unlike the list endpoint above, this one carries the boolean, so nothing
    // here has to infer a merge from a timestamp.
    state: data.merged ? 'merged' : closedOrOpen(data.state),
  }
}

/**
 * Builds the pull-request endpoints against an already-authenticated Octokit.
 *
 * `clean` is handed in rather than reached for, because outbound redaction is
 * `github.ts`'s boundary rule and this module is inside it: a title and a body
 * are assembled from model prose, check output and review summaries, and any of
 * those can carry a credential.
 */
export const createPullRequestEndpoints = (
  octokit: Octokit,
  repo: RepoRef,
  clean: (text: string) => string,
): PullRequestApi => ({
  findPullRequest: (head): Promise<PullRequestStatus | null> => findPullRequest(octokit, repo, head),
  getPullRequestHead: (prNumber): Promise<PullRequestHead> => getPullRequestHead(octokit, repo, prNumber),

  createPullRequest: async (input): Promise<PullRequestRef> => {
    const { data } = await octokit.rest.pulls.create({ ...repo, ...input, ...presentable(input, clean) })
    return { number: data.number, url: data.html_url }
  },

  updatePullRequest: async (number, patch): Promise<void> => {
    await octokit.rest.pulls.update({ ...repo, pull_number: number, ...presentable(patch, clean) })
  },
})
