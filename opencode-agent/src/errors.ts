// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Failures a phase handler can raise. They all end the same way — the
 * orchestrator parks the run in FAILED and posts the message on the issue — so
 * the message text is the whole contract.
 */
export class PipelineError extends Error {
  /** Machine-readable tag, useful when scanning job logs. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PipelineError'
    this.code = code
  }
}

export const missingSpecError = (issueNumber: number): PipelineError =>
  new PipelineError(
    'MISSING_SPEC',
    `No approved design spec found on issue #${issueNumber}. Was the spec comment deleted?`,
  )

export const missingPlanError = (issueNumber: number): PipelineError =>
  new PipelineError('MISSING_PLAN', `No plan found on issue #${issueNumber}. Was the plan comment deleted?`)

export const noChangesError = (issueNumber: number): PipelineError =>
  new PipelineError(
    'NO_CHANGES',
    `The agent finished the plan for issue #${issueNumber} without touching a single file. Nothing to commit.`,
  )

export const diffGuardError = (reason: string): PipelineError =>
  new PipelineError(
    'DIFF_GUARD',
    [
      `Refusing to commit: ${reason}.`,
      '',
      'The pipeline stages every change the model left behind, so this is usually',
      'a build artefact, a downloaded fixture, or a file written while debugging',
      'that the repository does not ignore. Add it to `.gitignore`, or raise',
      '`AGENT_MAX_CHANGED_FILES` / `AGENT_MAX_CHANGED_LINES` if the change really is that large.',
    ].join('\n'),
  )

/**
 * What GitHub says when the repository or organisation has "Allow GitHub Actions
 * to create and approve pull requests" switched off.
 *
 * Matched on the sentence rather than the status, because the status does not
 * distinguish it: this refusal arrives as a 403 exactly like a token missing
 * `pull-requests: write`, and the two have completely different remedies. The
 * sentence is GitHub's own and is what a maintainer will search for.
 */
const PR_CREATION_FORBIDDEN = 'not permitted to create or approve pull requests'

export const isPullRequestCreationForbidden = (error: unknown): boolean =>
  error instanceof Error && error.message.includes(PR_CREATION_FORBIDDEN)

/**
 * The refusal above, turned into something a maintainer can act on.
 *
 * The bare API message is the least useful failure this pipeline can post: it
 * names a setting without saying where it lives, it reads like a bug in the
 * agent, and it gives no hint that the work is finished and sitting on a pushed
 * branch — so `/retry` looks like the only move, and it fails again, and the
 * retry budget runs out on a condition no retry can change. That is exactly what
 * happened, twice, on the issue that prompted this.
 *
 * Both remedies are named because either one alone is a dead end for somebody:
 * the repository toggle is invisible to a maintainer without admin rights, and
 * an organisation policy overrides it, so a repository owner can tick the box and
 * still be refused. `AGENT_GITHUB_TOKEN` is the way out of both — the workflow
 * already prefers it over `GITHUB_TOKEN` — and it is what a repository wanting
 * CI to run on the agent's branch needs anyway.
 *
 * The compare link is the third way out and the only one that needs no
 * permissions at all: phase 3 pushed the branch, so the pull request exists in
 * every sense but the API call, and this opens it prefilled.
 */
export const pullRequestForbiddenError = (compareUrl: string, branch: string): PipelineError =>
  new PipelineError(
    'PR_FORBIDDEN',
    [
      'GitHub refused to open the pull request: Actions is not permitted to create or approve pull requests',
      'in this repository.',
      '',
      `Nothing is lost — \`${branch}\` is pushed and carries the whole change. Only opening the pull request is left.`,
      '',
      'Unblock it either way, then reply `/retry`:',
      '',
      '1. Settings → Actions → General → Workflow permissions → tick **Allow GitHub Actions to create and',
      '   approve pull requests**. An organisation policy overrides the repository setting, so if the box is',
      '   already ticked here, check the organisation too.',
      '2. Or set the `AGENT_GITHUB_TOKEN` secret to a personal access token or GitHub App installation token',
      '   with `pull_requests: write`. The workflow already prefers it over `GITHUB_TOKEN`, and it is what a',
      "   repository that wants CI to run on the agent's branch needs regardless.",
      '',
      `Or open it by hand, prefilled: ${compareUrl}`,
    ].join('\n'),
  )

export const openCodeError = (message: string): PipelineError => new PipelineError('OPENCODE', message)

export const modelResponseError = (message: string, raw: string): PipelineError =>
  new PipelineError('MODEL_RESPONSE', `${message}\n\nRaw reply:\n${raw.slice(0, 2000)}`)

export const missingSkillError = (phase: string, names: readonly string[]): PipelineError =>
  new PipelineError(
    'MISSING_SKILL',
    `Phase ${phase} requires skills that are not installed: ${names.join(', ')}. ` +
      'Check that the superpowers checkout step ran and populated .superpowers/skills.',
  )
