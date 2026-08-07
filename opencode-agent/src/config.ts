// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import type { CheckSpec } from './check-loop.js'
import type { OpenAiSettings } from './openai-config.js'

const checkSpecSchema = z.object({ name: z.string().min(1), argv: z.array(z.string().min(1)).min(1) })

/** Checks the CI-fix loop runs when the repo does not declare its own. */
export const DEFAULT_CHECKS: readonly CheckSpec[] = [
  { name: 'lint', argv: ['bun', 'run', 'lint'] },
  { name: 'typecheck', argv: ['bun', 'run', 'typecheck'] },
  { name: 'test', argv: ['bun', 'test'] },
]

export interface PipelineConfig {
  repoRoot: string
  owner: string
  repo: string
  githubToken: string
  /** Login treated as the agent's own identity for recursion guards. */
  selfLogin: string
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
  ciFixMaxRounds: number
  /** Ceiling on CI-fix rounds across the whole life of one pull request. */
  maxCiAttempts: number
  /** Above this, a FAILED issue stops auto-retrying and waits for `/retry`. */
  maxAttempts: number
  skillRoots: readonly string[]
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type Env = Record<string, string | undefined>

const required = (env: Env, key: string): string => {
  const value = env[key]
  if (value === undefined || value.trim().length === 0) {
    throw new ConfigError(`Missing required environment variable ${key}`)
  }
  return value.trim()
}

const optional = (env: Env, key: string, fallback: string): string => {
  const value = env[key]
  return value === undefined || value.trim().length === 0 ? fallback : value.trim()
}

/** Reads a positive integer knob, rejecting the values that silently break loops. */
const positiveInt = (env: Env, key: string, fallback: number): number => {
  const raw = env[key]
  if (raw === undefined || raw.trim().length === 0) return fallback

  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw.trim()) {
    throw new ConfigError(`${key} must be a positive integer, got "${raw}"`)
  }
  return parsed
}

/** Parses `GITHUB_REPOSITORY` (`owner/repo`), rejecting anything else. */
export const parseRepository = (raw: string): { owner: string; repo: string } => {
  const parts = raw.split('/')
  const [owner, repo] = parts
  if (parts.length !== 2 || owner === undefined || repo === undefined || owner === '' || repo === '') {
    throw new ConfigError(`GITHUB_REPOSITORY must be "owner/repo", got "${raw}"`)
  }
  return { owner, repo }
}

/** Parses `AGENT_CHECKS` — a JSON array of `{ name, argv }`. */
export const parseChecks = (raw: string | undefined): readonly CheckSpec[] => {
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_CHECKS

  const parsed = z.array(checkSpecSchema).min(1).safeParse(safeJson(raw))
  if (!parsed.success) throw new ConfigError(`AGENT_CHECKS is not a valid check list: ${parsed.error.message}`)
  return parsed.data
}

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new ConfigError('AGENT_CHECKS must be valid JSON')
  }
}

/**
 * Reads the single model endpoint.
 *
 * `OPENAI_MODEL` is required rather than defaulted: with a custom base URL
 * there is no model name that is right by default, and a wrong guess surfaces
 * deep inside the first model call instead of here.
 */
export const loadOpenAiSettings = (env: Env): OpenAiSettings => ({
  apiKey: required(env, 'OPENAI_API_KEY'),
  baseUrl: optional(env, 'OPENAI_BASE_URL', 'https://api.openai.com/v1'),
  model: required(env, 'OPENAI_MODEL'),
})

/** Skill roots searched in order; the vendored superpowers checkout wins. */
const DEFAULT_SKILL_ROOTS = ['.superpowers/skills', '.claude/skills'] as const

/** This repository's own review-loop workspace, when the checkout has one. */
const REVIEW_LOOP_ENTRY = 'review-loop/src/cli.ts'

/**
 * Resolves the review command.
 *
 * The default is this repository's `review-loop/` workspace, but it is detected
 * rather than assumed: a checkout without it has *no review configured*, which
 * is a different thing from a review that failed. Baking the path in made every
 * run elsewhere report a permanently red review reading `Module not found` —
 * the same papai-specific hardcoding the mutation check was removed for.
 *
 * `AGENT_REVIEW_COMMAND` overrides with a JSON argv array; `"none"` disables it.
 */
export const resolveReviewCommand = (
  raw: string | undefined,
  repoRoot: string,
  exists: (filePath: string) => boolean,
): readonly string[] | null => {
  const configured = raw === undefined ? '' : raw.trim()
  if (configured.toLowerCase() === 'none') return null

  if (configured.length > 0) {
    const parsed = z.array(z.string().min(1)).min(1).safeParse(safeJsonArgv(configured))
    if (!parsed.success) throw new ConfigError(`AGENT_REVIEW_COMMAND must be a JSON array of strings`)
    return parsed.data
  }

  return exists(path.join(repoRoot, REVIEW_LOOP_ENTRY)) ? ['bun', 'run', REVIEW_LOOP_ENTRY] : null
}

const safeJsonArgv = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new ConfigError('AGENT_REVIEW_COMMAND must be valid JSON')
  }
}

/** Where {@link resolveBaseBranch} looks once `AGENT_BASE_BRANCH` is unset. */
export interface BaseBranchSources {
  /** `repository.default_branch` from the webhook payload, when it carried one. */
  fromEvent: string | null
  /** The checkout's own view of `origin/HEAD`, for runs driven from a file. */
  fromGit: () => Promise<string | null>
}

/**
 * Resolves the branch new work forks from and pull requests target.
 *
 * There is deliberately no literal fallback. This used to default to `main`,
 * which was wrong for the repository the spike lives in — its default branch is
 * `master` — so every local run died on `fatal: couldn't find remote ref main`.
 * Substituting `master` would only move the breakage elsewhere: the name is a
 * per-repository fact, not something with a sensible default.
 *
 * Both callers above already know it — the webhook payload carries
 * `repository.default_branch` and a checkout carries `origin/HEAD` — so this
 * asks them in order and fails naming the override rather than guessing.
 */
export const resolveBaseBranch = async (env: Env, sources: BaseBranchSources): Promise<string> => {
  const override = env['AGENT_BASE_BRANCH']
  if (override !== undefined && override.trim().length > 0) return override.trim()

  const fromEvent = sources.fromEvent
  if (fromEvent !== null && fromEvent.trim().length > 0) return fromEvent.trim()

  const detected = await sources.fromGit()
  if (detected !== null && detected.trim().length > 0) return detected.trim()

  throw new ConfigError(
    'Cannot determine the base branch: the event payload carries no repository.default_branch and this checkout has no origin/HEAD. Set AGENT_BASE_BRANCH.',
  )
}

/** Builds the pipeline config from the runner environment. */
export const loadConfig = (env: Env, repoRoot: string): PipelineConfig => {
  const { owner, repo } = parseRepository(required(env, 'GITHUB_REPOSITORY'))

  return {
    repoRoot,
    owner,
    repo,
    githubToken: required(env, 'GITHUB_TOKEN'),
    selfLogin: optional(env, 'AGENT_SELF_LOGIN', owner),
    selfWorkflowName: optional(env, 'AGENT_WORKFLOW_NAME', 'OpenCode Issue Agent'),
    openai: loadOpenAiSettings(env),
    commitAuthorName: optional(env, 'AGENT_COMMIT_NAME', 'opencode-agent[bot]'),
    commitAuthorEmail: optional(env, 'AGENT_COMMIT_EMAIL', 'opencode-agent@users.noreply.github.com'),
    checkCommand: optional(env, 'AGENT_CHECK_COMMAND', 'bun run lint && bun run typecheck && bun test'),
    reviewCommand: resolveReviewCommand(env['AGENT_REVIEW_COMMAND'], repoRoot, existsSync),
    checks: parseChecks(env['AGENT_CHECKS']),
    reviewMaxRounds: positiveInt(env, 'AGENT_REVIEW_MAX_ROUNDS', 4),
    reviewPoolSize: positiveInt(env, 'AGENT_REVIEW_POOL_SIZE', 2),
    agentTimeoutMs: positiveInt(env, 'AGENT_TIMEOUT_MS', 1_800_000),
    ciFixMaxRounds: positiveInt(env, 'AGENT_CI_FIX_MAX_ROUNDS', 2),
    maxCiAttempts: positiveInt(env, 'AGENT_MAX_CI_ATTEMPTS', 3),
    maxAttempts: positiveInt(env, 'AGENT_MAX_ATTEMPTS', 3),
    skillRoots: DEFAULT_SKILL_ROOTS,
  }
}
