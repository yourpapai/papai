// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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
  baseBranch: string
  commitAuthorName: string
  commitAuthorEmail: string
  /** Build gate the review-loop workspace runs between rounds. */
  checkCommand: string
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
    baseBranch: optional(env, 'AGENT_BASE_BRANCH', 'main'),
    commitAuthorName: optional(env, 'AGENT_COMMIT_NAME', 'opencode-agent[bot]'),
    commitAuthorEmail: optional(env, 'AGENT_COMMIT_EMAIL', 'opencode-agent@users.noreply.github.com'),
    checkCommand: optional(env, 'AGENT_CHECK_COMMAND', 'bun run lint && bun run typecheck && bun test'),
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
