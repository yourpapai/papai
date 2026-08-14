// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'

import type { CheckSpec } from './check-loop.js'
import { resolveReviewCommand } from './config-discovery.js'
import {
  boundedInt,
  boundedIntOrNull,
  buildDiffLimits,
  DEFAULT_REVIEW_POOL_SIZE,
  DEFAULT_TURN_TIMEOUT_MS,
  EPOCH_MS_RANGE,
  JOB_MINUTES_RANGE,
  labelPrefix,
  LINES_RANGE,
  logKey,
  optional,
  optionalOrNull,
  parseChecks,
  POOL_RANGE,
  required,
  RESERVE_RANGE,
  ROUND_RANGE,
  TIMEOUT_RANGE,
  TOKEN_RANGE,
  WRAP_UP_RANGE,
} from './config-values.js'
import type { Env } from './config-values.js'
import type { DiffLimits } from './diff-guard.js'
import type { OpenAiSettings } from './openai-config.js'
import { parseRepository } from './repository.js'

// Re-exported so the many modules that already import them from here keep
// working; they are declared next to the validators that raise and consume them.
// `parseChecks` is *imported* as well as re-exported, and has to be: a bare re-export
// binds no local name, and `loadConfig` calls it — which typechecks and then throws
// `ReferenceError` at runtime.
export { DEFAULT_CHECKS, ConfigError, parseChecks } from './config-values.js'
export type { Env } from './config-values.js'

export interface PipelineConfig {
  repoRoot: string
  owner: string
  repo: string
  githubToken: string
  /**
   * `AGENT_SELF_LOGIN`, or `null` to derive it from the token.
   *
   * Not defaulted to the owner here: that default was indistinguishable from a
   * deliberate choice, and it is wrong for every token that posts as a bot.
   * `resolveSelfLogin` owns the fallback, and warns when it takes it.
   */
  selfLoginOverride: string | null
  /** This pipeline's workflow name, so its own red runs do not re-trigger it. */
  selfWorkflowName: string
  openai: OpenAiSettings
  commitAuthorName: string
  commitAuthorEmail: string
  /** Build gate the review loop runs between rounds. */
  checkCommand: string
  /** Argv that runs the review loop, or `null` when this repo has none. */
  reviewCommand: readonly string[] | null
  /** Commands the CI-fix phase runs locally to reproduce a red pull request. */
  checks: readonly CheckSpec[]
  reviewMaxRounds: number
  reviewPoolSize: number
  agentTimeoutMs: number
  /**
   * Epoch ms at which this **job** is killed by its own `timeout-minutes`, or
   * `null` when nothing has said.
   *
   * Absolute rather than a duration, because that is the only form both halves of
   * the answer survive in: the job's start comes from a first step in the
   * workflow and its length from a repository variable, and neither is knowable
   * from the other. Derived once at load, so nothing downstream has to remember
   * to add them up.
   *
   * `null` is the ordinary local case — a `--event-path` run has no Actions job
   * and no ceiling to stay under, and is bounded by {@link agentTimeoutMs} alone,
   * exactly as every run was before this existed. It is deliberately not defaulted
   * to "now plus something": `AGENT_TIMEOUT_MS` guessed at a runner cap for
   * exactly one release and this is that mistake with a clock attached.
   */
  jobDeadlineMs: number | null
  /**
   * How much of the job is held back from the work, so the stop can be reported.
   *
   * `git add`, the diff guard, the commit, the push, the comment, the state block
   * and the label are what a stop still has to do, and the observed tail for all
   * of it is about ten seconds. Reserving minutes is cheap; not reserving them is
   * the runner death this whole bound exists to replace.
   */
  teardownReserveMs: number
  /**
   * The middle slice: how long the model gets to wrap up after a turn is stopped.
   *
   * Held back from the **work**, not from the teardown reserve: the reserve buys the
   * commit, the comment and the state block that make a stop something other than a
   * silence, and a wrap-up that ate it would leave nothing to report with.
   *
   * What it buys is the handoff note, the one thing only the model that did the work
   * can write: what it finished, what remains, and what it tried that did not work.
   * A fresh session can read the diff and the plan; it cannot recover that last line.
   */
  wrapUpMs: number
  /** Model tokens one issue may spend, across every job it runs. */
  maxTokens: number
  ciFixMaxRounds: number
  /**
   * Commit attempts one commit gets, including the first, when the repository's
   * own pre-commit checks refuse it.
   *
   * Higher than `ciFixMaxRounds` on purpose, and the two are not the same
   * quantity. A CI-fix round re-runs whole check suites and costs minutes; a
   * commit repair round is one model turn over output already in hand, and what
   * it is spent against is losing the phase — a `/retry` buys a fresh job that
   * re-runs the model turn that had already succeeded. `1` disables repair.
   */
  commitRepairMaxRounds: number
  /** Ceiling on CI-fix rounds across the whole life of one pull request. */
  maxCiAttempts: number
  /** Ceiling on `/review` rounds across the whole life of one pull request. */
  maxReviewAttempts: number
  /**
   * Diff size, in changed lines, above which a delivery recommends `/review`.
   *
   * A threshold rather than a rule: the delivery comment names the command
   * whatever the figure is, and this only decides whether it also says it would
   * run it. Read where the comment is written rather than baked into the state
   * block, so lowering it applies to every issue in flight rather than only to
   * the ones implemented after the change.
   */
  reviewHintLines: number
  /** Above this, a FAILED issue stops auto-retrying and waits for `/retry`. */
  maxAttempts: number
  /** Ceilings a staged change set must stay under before it is committed. */
  diffLimits: DiffLimits
  /**
   * Base URL the git credential header is scoped to. Configurable because the
   * pipeline is not GitHub.com-only: an Enterprise Server install answers on its
   * own host, and a header scoped to the wrong one is silently not sent.
   */
  gitRemoteBase: string
  /**
   * The Actions run executing this pipeline, or `null` when there is not one.
   *
   * Nullable rather than required because a local `--event-path` run is an
   * ordinary way to use this CLI, not a misconfiguration — so every renderer
   * that takes this has to be able to say nothing rather than link nowhere.
   */
  runUrl: string | null
  /**
   * Namespace every label this pipeline writes lives under, or `null` when
   * `AGENT_LABEL_PREFIX=none` switches labelling off.
   *
   * Nullable rather than an empty string: an empty prefix would make *every*
   * label on the issue look agent-owned to the reconcile, which removes any it
   * cannot account for — so the one value that reads as "no namespace" is the
   * one value that must never reach it.
   */
  labelPrefix: string | null
  /**
   * The debug transcript's AES-256-GCM key, or `null` when no transcript is
   * written.
   *
   * Raw bytes rather than the base64 the operator set, because its one consumer
   * is `crypto.subtle`. `null` rather than required: most runs have no
   * transcript, and a keyless run warns once and behaves exactly as it did
   * before this existed.
   */
  logKey: Uint8Array | null
  skillRoots: readonly string[]
}

/**
 * The namespace labels take when the operator names none.
 *
 * Exported for the same reason `REPORTED_OUTPUT` is: the workflow's label
 * cleanup step has to default the prefix in shell, where it cannot import
 * anything, so `tests/opencode-agent/workflow.test.ts` pins that literal against
 * this one rather than letting two spellings of the default drift apart.
 */
export const DEFAULT_LABEL_PREFIX = 'agent:'

/**
 * Reads the single model endpoint.
 *
 * `LLM_MODEL` is required rather than defaulted: with a custom base URL there
 * is no model name that is right by default, and a wrong guess surfaces deep
 * inside the first model call instead of here. `LLM_BASE_URL` is required for
 * the same reason: defaulting it to OpenAI's own endpoint made a missing
 * value look like a deliberate choice instead of a misconfiguration, and this
 * pipeline is built around one arbitrary configured endpoint, not OpenAI
 * specifically.
 */
export const loadOpenAiSettings = (env: Env): OpenAiSettings => ({
  apiKey: required(env, 'LLM_API_KEY'),
  baseUrl: required(env, 'LLM_BASE_URL'),
  model: required(env, 'LLM_MODEL'),
})

/** Loader roots, first-hit-wins (D11): in-repo OpenSpec trees first, then the pinned superpowers checkout. */
const DEFAULT_SKILL_ROOTS = ['.opencode/skills', '.agents/skills', '.superpowers/skills', '.claude/skills'] as const

/**
 * Builds the URL of the run this process is executing in.
 *
 * No workflow change is needed for any of it: GitHub sets `GITHUB_RUN_ID`,
 * `GITHUB_RUN_ATTEMPT`, `GITHUB_SERVER_URL` and `GITHUB_REPOSITORY` in the
 * environment of every step, and `scrubSecrets` matches by *value*, so none of
 * them is stripped on the way past. `serverBase` is the same value
 * `gitRemoteBase` carries, for the same reason it is configurable at all — an
 * Enterprise Server install answers on its own host.
 *
 * The attempt segment is appended only above 1. GitHub's own run link omits it
 * on a first attempt, and a re-run's logs live under the attempt path, so a job
 * on attempt 3 linking `/attempts/1` would point a maintainer at the logs of the
 * run it superseded. An unparseable attempt is treated as a first one rather
 * than rejected: this is a link, and a config error over decoration would fail
 * the run the link exists to explain.
 */
const buildRunUrl = (env: Env, serverBase: string, owner: string, repo: string): string | null => {
  const runId = optionalOrNull(env, 'GITHUB_RUN_ID')
  if (runId === null) return null

  const attempt = Number.parseInt(optional(env, 'GITHUB_RUN_ATTEMPT', '1'), 10)
  const suffix = Number.isSafeInteger(attempt) && attempt > 1 ? `/attempts/${attempt}` : ''
  return `${serverBase}${owner}/${repo}/actions/runs/${runId}${suffix}`
}

/**
 * When this job is killed by its own timeout, from the two facts that say so.
 *
 * Both or neither: a start with no ceiling and a ceiling with no start each
 * describe half a deadline, and half a deadline is not a bound. Returning `null`
 * rather than guessing the missing half is what keeps a local run — and any
 * workflow that has not been updated — behaving exactly as it did before.
 *
 * The start is recorded by a step rather than read from the payload, because
 * `timeout-minutes` counts from when the **job** started and nothing in the event
 * says when that was. That step runs a few seconds after the job itself, so this
 * lands a few seconds late — absorbed by the teardown reserve, which is minutes.
 */
const buildJobDeadline = (env: Env): number | null => {
  const startedMs = boundedIntOrNull(env, 'AGENT_JOB_STARTED_MS', EPOCH_MS_RANGE)
  const timeoutMinutes = boundedIntOrNull(env, 'AGENT_JOB_TIMEOUT_MINUTES', JOB_MINUTES_RANGE)
  if (startedMs === null || timeoutMinutes === null) return null

  return startedMs + timeoutMinutes * 60_000
}

/** Builds the pipeline config from the runner environment. */
export const loadConfig = (env: Env, repoRoot: string): PipelineConfig => {
  const { owner, repo } = parseRepository(required(env, 'GITHUB_REPOSITORY'))
  const gitRemoteBase = optional(env, 'GITHUB_SERVER_URL', 'https://github.com').replace(/\/*$/u, '/')

  return {
    repoRoot,
    owner,
    repo,
    githubToken: required(env, 'GITHUB_TOKEN'),
    selfLoginOverride: optionalOrNull(env, 'AGENT_SELF_LOGIN'),
    selfWorkflowName: optional(env, 'AGENT_WORKFLOW_NAME', 'OpenCode Issue Agent'),
    openai: loadOpenAiSettings(env),
    gitRemoteBase,
    runUrl: buildRunUrl(env, gitRemoteBase, owner, repo),
    labelPrefix: labelPrefix(env, 'AGENT_LABEL_PREFIX', DEFAULT_LABEL_PREFIX),
    logKey: logKey(env, 'AGENT_LOG_KEY'),
    commitAuthorName: optional(env, 'AGENT_COMMIT_NAME', 'opencode-agent[bot]'),
    commitAuthorEmail: optional(env, 'AGENT_COMMIT_EMAIL', 'opencode-agent@users.noreply.github.com'),
    checkCommand: optional(env, 'AGENT_CHECK_COMMAND', 'bun check:full'),
    reviewCommand: resolveReviewCommand(env['AGENT_REVIEW_COMMAND'], repoRoot, existsSync),
    checks: parseChecks(env['AGENT_CHECKS']),
    reviewMaxRounds: boundedInt(env, 'AGENT_REVIEW_MAX_ROUNDS', 4, ROUND_RANGE),
    reviewPoolSize: boundedInt(env, 'AGENT_REVIEW_POOL_SIZE', DEFAULT_REVIEW_POOL_SIZE, POOL_RANGE),
    agentTimeoutMs: boundedInt(env, 'AGENT_TIMEOUT_MS', DEFAULT_TURN_TIMEOUT_MS, TIMEOUT_RANGE),
    jobDeadlineMs: buildJobDeadline(env),
    teardownReserveMs: boundedInt(env, 'AGENT_TEARDOWN_RESERVE_MS', 180_000, RESERVE_RANGE),
    wrapUpMs: boundedInt(env, 'AGENT_WRAP_UP_MS', 120_000, WRAP_UP_RANGE),
    ciFixMaxRounds: boundedInt(env, 'AGENT_CI_FIX_MAX_ROUNDS', 2, ROUND_RANGE),
    commitRepairMaxRounds: boundedInt(env, 'AGENT_COMMIT_REPAIR_MAX_ROUNDS', 3, ROUND_RANGE),
    maxCiAttempts: boundedInt(env, 'AGENT_MAX_CI_ATTEMPTS', 3, ROUND_RANGE),
    maxReviewAttempts: boundedInt(env, 'AGENT_MAX_REVIEW_ATTEMPTS', 3, ROUND_RANGE),
    // `LINES_RANGE`, the same bound `AGENT_MAX_CHANGED_LINES` takes, because it
    // is the same quantity read off the same measurement — and because both ends
    // matter here too: 0 would recommend a review on every delivery, which is
    // the same as having no recommendation.
    reviewHintLines: boundedInt(env, 'AGENT_REVIEW_HINT_LINES', 200, LINES_RANGE),
    maxAttempts: boundedInt(env, 'AGENT_MAX_ATTEMPTS', 5, ROUND_RANGE),
    maxTokens: boundedInt(env, 'AGENT_MAX_TOKENS', 5_000_000, TOKEN_RANGE),
    diffLimits: buildDiffLimits(env),
    skillRoots: DEFAULT_SKILL_ROOTS,
  }
}
