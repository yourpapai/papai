// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'

import { resolveReviewCommand } from './config-discovery.js'
import type { PipelineConfig } from './config-shape.js'
import {
  boundedInt,
  boundedIntOrNull,
  boolOrNull,
  buildDiffLimits,
  CONTEXT_RANGE,
  DEFAULT_REVIEW_POOL_SIZE,
  DEFAULT_TURN_TIMEOUT_MS,
  effortTier,
  EPOCH_MS_RANGE,
  JOB_MINUTES_RANGE,
  labelPrefix,
  LINES_RANGE,
  logKey,
  optional,
  optionalOrNull,
  OUTPUT_RANGE,
  parseChecks,
  parseMcpServers,
  POOL_RANGE,
  providerId,
  required,
  RESERVE_RANGE,
  ROUND_RANGE,
  TIMEOUT_RANGE,
  TOKEN_RANGE,
  WRAP_UP_RANGE,
} from './config-values.js'
import type { Env } from './config-values.js'
import { DEFAULT_PROVIDER_ID } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import { parseRepository } from './repository.js'

// Re-exported so the many modules that already import them from here keep
// working; they are declared next to the validators that raise and consume them.
// `parseChecks` is *imported* as well as re-exported, and has to be: a bare re-export
// binds no local name, and `loadConfig` calls it — which typechecks and then throws
// `ReferenceError` at runtime.
export { DEFAULT_CHECKS, ConfigError, parseChecks } from './config-values.js'
export type { Env } from './config-values.js'
export type { PipelineConfig } from './config-shape.js'

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
  // Optional and defaulted, unlike the three above, because the default is
  // exactly today's behaviour: `openai` is the id the pipeline hardcoded before
  // this knob existed, so an unset variable emits the same config it always did.
  provider: providerId(env, 'LLM_PROVIDER', DEFAULT_PROVIDER_ID),
  // Read as three separate absences rather than one defaulted block: each is a
  // fact about somebody else's server that only an operator can state, and a
  // guessed default is either a window that compacts every turn or one that
  // never compacts at all.
  overrides: {
    context: boundedIntOrNull(env, 'AGENT_MODEL_CONTEXT', CONTEXT_RANGE),
    output: boundedIntOrNull(env, 'AGENT_MODEL_OUTPUT', OUTPUT_RANGE),
    reasoning: boolOrNull(env, 'AGENT_MODEL_REASONING'),
  },
  // Which profile gets which model and how much effort. All three absent by
  // default, so a repository that sets none of them emits the config it always
  // did — the light model is only the read-only profile's, never `build`'s.
  profiles: {
    light: optionalOrNull(env, 'LLM_MODEL_LIGHT'),
    planEffort: effortTier(env, 'AGENT_EFFORT_PLAN'),
    buildEffort: effortTier(env, 'AGENT_EFFORT_BUILD'),
  },
  // The second non-scalar knob, read here so an unloadable value fails at job
  // start — before any model turn is spent — and riding the settings so the
  // one config builder both execution paths read carries it by construction.
  // Unset is the ordinary case and emits nothing at all.
  mcpServers: parseMcpServers(env['AGENT_MCP_SERVERS']),
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
    commitAuthorName: optional(env, 'AGENT_COMMIT_NAME', 'github-actions[bot]'),
    commitAuthorEmail: optional(env, 'AGENT_COMMIT_EMAIL', '41898282+github-actions[bot]@users.noreply.github.com'),
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
    syncRepairMaxRounds: boundedInt(env, 'AGENT_SYNC_REPAIR_MAX_ROUNDS', 3, ROUND_RANGE),
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
