// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ProgressSnapshot } from './progress.js'

/**
 * Failures a phase handler can raise. Almost all of them end the same way — the
 * orchestrator parks the run in FAILED and posts the message on the issue — so
 * the message text is very nearly the whole contract.
 *
 * `code` is the exception, and {@link import('./turn-errors.js').turnDeadlineError}
 * is why it now matters to more than a log reader: a handful of failures here
 * are **not** the work breaking, and the handler that raised one has to be able
 * to tell. One class per file is the workspace's rule, so that distinction is a
 * code and a payload on this class rather than a subclass of it — which also
 * keeps every existing `catch` and every renderer reading a `PipelineError`
 * exactly as it was.
 *
 * The turn-family failures — the four a handler branches on by code — live in
 * `turn-errors.ts` since the stall bound pushed them out of this file, and are
 * re-exported below so callers keep naming one module. Same arrangement as
 * `config-clock-values.ts`.
 */
export class PipelineError extends Error {
  /** Machine-readable tag, useful when scanning job logs. */
  readonly code: string
  /**
   * What the model turn had achieved when a bound stopped it, and `null` for
   * every other failure — which is not the same fact as a turn that did nothing.
   *
   * Carried rather than re-measured because only the adapter can see it: the
   * tracker lives beside the event stream, and by the time a phase has the
   * rejection in hand there is nothing left to ask.
   */
  readonly progress: ProgressSnapshot | null

  constructor(code: string, message: string, progress: ProgressSnapshot | null = null) {
    super(message)
    this.name = 'PipelineError'
    this.code = code
    this.progress = progress
  }
}

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
 * to create or approve pull requests" switched off.
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
 * Both remedies are named because either one alone is a dead end for somebody,
 * and the **greyed-out** case is called out by name because it is the one that
 * wastes the most time: an organisation can lock the whole Workflow permissions
 * section, and then the repository setting is not merely unticked but disabled,
 * so a maintainer sent to "tick the box" arrives at a control they cannot click
 * and has nothing telling them where the setting actually lives. That is the
 * state the repository this was written for was in.
 *
 * `AGENT_GITHUB_TOKEN` is the way out of both, and the one to reach for first: a
 * PAT or App installation token is not "GitHub Actions" as far as this rule is
 * concerned, so it needs no policy change at all — it is scoped to this one
 * workflow rather than loosening every repository in the organisation, and it
 * is what a repository wanting CI to run on the agent's branch needs anyway, since
 * pushes made with `GITHUB_TOKEN` deliberately trigger no workflows.
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
      '1. Set the `AGENT_GITHUB_TOKEN` secret to a personal access token or GitHub App installation token',
      '   with `pull_requests: write`, and `AGENT_SELF_LOGIN` to the account it posts as. The workflow already',
      '   prefers it over `GITHUB_TOKEN`; a token like that is not "GitHub Actions" as far as this rule goes,',
      "   so it needs no policy change — and it is what a repository that wants CI to run on the agent's",
      '   branch needs regardless, since pushes made with `GITHUB_TOKEN` trigger no workflows.',
      '2. Or Settings → Actions → General → Workflow permissions → **Allow GitHub Actions to create and',
      '   approve pull requests**. If that checkbox is **greyed out**, the organisation owns the setting and',
      '   the repository cannot override it: change it under the organisation’s own Actions settings instead',
      '   — which unlocks it for every repository in the organisation, so option 1 is usually the smaller step.',
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

// The turn family — every failure a handler branches on by `code` rather than
// merely logs. Declared in `turn-errors.ts` since the stall bound pushed them
// out of this file; re-exported rather than moved out of reach for the same
// reason `check-spec.ts`'s knobs are: callers name this module for the
// vocabulary, and a moved export would be a rename dressed up as a file split.
export {
  isServerGone,
  isTurnDeadline,
  isTurnStall,
  providerStalledError,
  serverGoneError,
  turnDeadlineError,
  turnStallError,
} from './turn-errors.js'

/**
 * The end of an exhaustive `switch` over a discriminated union.
 *
 * Written out rather than left implicit for two reasons, and the second is the
 * one that matters. The lint rule wanting every path to return cannot see that
 * TypeScript has already proved this one unreachable — and the `never` parameter
 * is what turns *adding* a union member into a compile error at every switch
 * that did not grow a case for it. Which is exactly the property the `kind`
 * switches were written for: a third trigger kind arrived, and the tests that
 * had been spelled `!== 'issue'` would have bucketed it in silence.
 *
 * Here rather than in `types.ts`, where it began: it is not a type, it is a throw,
 * and this is the file that says how this pipeline throws. Deliberately **not** a
 * `PipelineError` — those are failures a phase reports on the issue and a `/retry`
 * might fix, and this one can only ever mean the code is wrong.
 */
export const unreachable = (value: never): never => {
  throw new Error(`Unreachable value: ${JSON.stringify(value)}`)
}
