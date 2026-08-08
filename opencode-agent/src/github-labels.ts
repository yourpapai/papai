// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Octokit } from '@octokit/rest'

/**
 * The label half of the GitHub surface.
 *
 * Split out of `github.ts` when the four methods here pushed that file past
 * `max-lines`, along the seam that was already there: labels are one endpoint
 * family with semantics none of the other calls have. They are created on
 * demand, "it already exists" is a success rather than a failure, and — unlike a
 * comment or a pull request body — they carry no free text, so the redaction
 * `github.ts` applies at its boundary has nothing to do here.
 *
 * That last point is the exemption stated rather than implied, exactly as
 * `ReactionContent` and the `head`/`base` branch names state it: every name that
 * reaches these methods is `AGENT_LABEL_PREFIX` — validated at load — followed by
 * a suffix out of `presentation.ts`'s closed table, and a value the pipeline
 * assembles from two of its own constants has nowhere for a credential to hide.
 *
 * Nothing here is best-effort. A rejection is reported to the caller like any
 * other, because "a failed label must never fail a run" is a decision about the
 * pipeline and lives in `labels.ts`, at the one door to this API — the same
 * division `github.ts` and `feedback.ts` already draw for reactions.
 */
export interface LabelApi {
  /** Every label currently on the issue, agent-owned or not, by name. */
  listLabels(issueNumber: number): Promise<string[]>
  /** Adds labels, leaving the ones already there alone. */
  addLabels(issueNumber: number, names: readonly string[]): Promise<void>
  /** Removes one label from the issue; the label itself survives in the repo. */
  removeLabel(issueNumber: number, name: string): Promise<void>
  /**
   * Creates a repository label, treating "it already exists" as success.
   *
   * Idempotence at the transport layer, where the HTTP status still exists: a
   * repeat create answers 422, and by the time that reaches a caller it is an
   * `Error` message indistinguishable from a real refusal. This is *not* the
   * best-effort rule — a 403 from a token without `issues: write` still rejects
   * here and is swallowed one layer up, where that decision belongs.
   */
  createLabel(name: string, color: string): Promise<void>
}

/** Status of a rejected Octokit call, when it carried one. */
const statusOf = (error: unknown): number | null =>
  typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : null

/** GitHub's answer to creating a label that is already there. */
const ALREADY_EXISTS = 422

const createLabel = async (octokit: Octokit, repo: RepoRef, name: string, color: string): Promise<void> => {
  try {
    await octokit.rest.issues.createLabel({ ...repo, name, color })
  } catch (error) {
    if (statusOf(error) !== ALREADY_EXISTS) throw error
  }
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

/** Builds the label endpoints against an already-authenticated Octokit. */
export const createLabelEndpoints = (octokit: Octokit, repo: RepoRef): LabelApi => ({
  listLabels: async (issueNumber): Promise<string[]> => {
    const labels = await octokit.paginate(octokit.rest.issues.listLabelsOnIssue, {
      ...repo,
      issue_number: issueNumber,
      per_page: 100,
    })
    return labels.map((label) => label.name)
  },

  addLabels: async (issueNumber, names): Promise<void> => {
    await octokit.rest.issues.addLabels({ ...repo, issue_number: issueNumber, labels: [...names] })
  },

  // A label removed between the read and this call answers 404. It is not
  // special-cased: the reconcile that issued it is best-effort, so the warning
  // it degrades to is the right amount of noise for a race whose only
  // consequence is that the next event repairs what this one could not.
  removeLabel: async (issueNumber, name): Promise<void> => {
    await octokit.rest.issues.removeLabel({ ...repo, issue_number: issueNumber, name })
  },

  createLabel: (name, color): Promise<void> => createLabel(octokit, repo, name, color),
})
