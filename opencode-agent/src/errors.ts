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
 * `code` is the exception, and {@link TURN_DEADLINE} is why it now matters to more
 * than a log reader: one failure here is **not** the work breaking, and the
 * handler that raised it has to be able to tell. One class per file is the
 * workspace's rule, so that distinction is a code and a payload on this class
 * rather than a subclass of it — which also keeps every existing `catch` and every
 * renderer reading a `PipelineError` exactly as it was.
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
 * workflow rather than loosening every repository in the organisation, and it is
 * what a repository wanting CI to run on the agent's branch needs anyway, since
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

/** The one code a handler branches on rather than merely logs. */
const TURN_DEADLINE = 'TURN_DEADLINE'

/**
 * A model turn stopped by its own bound, said in a way the phase can act on and a
 * reader can believe.
 *
 * The message this replaces was `The model did not answer within 1800000ms`, about
 * a turn that answered **355 times** at roughly twelve tool calls a minute and was
 * cut off mid-`bash`. That wording describes a hang, so it sent whoever read it
 * looking for one and gave them a healthy turn and no explanation. What is true is
 * that the turn was working and ran out of clock, and the numbers saying so were
 * already in hand — the heartbeat had been printing them once a minute.
 *
 * Distinguishable by code because the consequence differs, which is the whole
 * finding: every other rejection out of a prompt means the work broke and belongs
 * in `failRun` as ❌ with an attempt spent, and this one means a ceiling was
 * reached in a run where nothing broke — so it salvages the tree, parks in
 * `INCOMPLETE` and spends nothing.
 */
export const turnDeadlineError = (elapsedMs: number, progress: ProgressSnapshot): PipelineError =>
  new PipelineError(
    TURN_DEADLINE,
    `The turn ran out of time after ${elapsedMs}ms and was stopped part-way through: ` +
      `${progress.toolCalls} tool calls, ${progress.tokens.toLocaleString('en-US')} tokens, ` +
      `last action "${progress.lastAction}". The bound is \`AGENT_TIMEOUT_MS\`, shrunk to fit what was left of ` +
      "the job's own deadline.",
    progress,
  )

/**
 * Whether a rejection is that stop.
 *
 * A predicate here rather than a `code` comparison at the call site, for the reason
 * {@link isPullRequestCreationForbidden} is one: the tag is this module's business,
 * and a handler spelling it out is a second copy of a string that has to agree.
 */
export const isTurnDeadline = (error: unknown): error is PipelineError =>
  error instanceof PipelineError && error.code === TURN_DEADLINE

/** The other failure a reader cannot diagnose from its message alone. */
const SERVER_GONE = 'OPENCODE_SERVER_GONE'

/**
 * A turn whose OpenCode server stopped answering, named rather than quoted.
 *
 * Issue #239 failed twice with `The socket connection was closed unexpectedly`,
 * which is Bun's wording for a `fetch` whose peer went away and names neither
 * end of it. Every reader starts at the model provider, because that is the only
 * remote a model turn obviously has. It was the `opencode serve` **this job
 * spawned** — established only afterwards, and only by inference: the
 * `session.get` that `tokensUsed()` makes next failed too, and that call is a
 * loopback request no provider is on the path of. So the evidence was in hand at
 * the moment of failure and thrown away, and the run reported the one sentence
 * that sends you the wrong way.
 *
 * This asks the question instead of leaving it to be reconstructed from two log
 * lines a week later. The transport's own message is kept, because it is the only
 * account of *how* the socket went; what is added is which socket it was, and
 * where to look for the cause — the post-mortem step, which reports an
 * out-of-memory kill and a second `opencode` process precisely because neither is
 * visible from here.
 *
 * Distinguishable by code for the reason {@link turnDeadlineError} is, and it is
 * checked **after** that one: a deadline is a ceiling the phase salvages work for,
 * and a turn cut off by its own bound must keep meaning that even when the probe
 * that runs afterwards finds the server gone too.
 */
export const serverGoneError = (transport: string): PipelineError =>
  new PipelineError(
    SERVER_GONE,
    'The local OpenCode server stopped answering mid-turn, so this turn ended with nothing to show for it. ' +
      `The transport reported: ${transport}. That is the \`opencode serve\` this job spawned on loopback — ` +
      'not the model provider — so look at the run’s post-mortem step for an out-of-memory kill or for a ' +
      'second `opencode` process the model started from `bash`.',
  )

/** Whether a rejection is that death. */
export const isServerGone = (error: unknown): error is PipelineError =>
  error instanceof PipelineError && error.code === SERVER_GONE

export const modelResponseError = (message: string, raw: string): PipelineError =>
  new PipelineError('MODEL_RESPONSE', `${message}\n\nRaw reply:\n${raw.slice(0, 2000)}`)

export const missingSkillError = (phase: string, names: readonly string[]): PipelineError =>
  new PipelineError(
    'MISSING_SKILL',
    `Phase ${phase} requires skills that are not installed: ${names.join(', ')}. ` +
      'Check that the superpowers checkout step ran and populated .superpowers/skills.',
  )

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
