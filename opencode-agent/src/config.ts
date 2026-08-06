// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { CheckSpec } from './review-loop.js'

const checkSpecSchema = z.object({ name: z.string().min(1), argv: z.array(z.string().min(1)).min(1) })

/** Checks the review loop runs when the repo does not declare its own. */
export const DEFAULT_CHECKS: readonly CheckSpec[] = [
  { name: 'lint', argv: ['bun', 'run', 'lint'] },
  { name: 'typecheck', argv: ['bun', 'run', 'typecheck'] },
  { name: 'test', argv: ['bun', 'test'] },
]

export const DEFAULT_MUTATION_CHECK: CheckSpec = {
  name: 'mutation',
  argv: ['bun', 'run', 'test:mutate:changed'],
}

export interface PipelineConfig {
  repoRoot: string
  owner: string
  repo: string
  githubToken: string
  /** Login treated as the agent's own identity for recursion guards. */
  selfLogin: string
  model: string
  baseBranch: string
  commitAuthorName: string
  commitAuthorEmail: string
  checks: readonly CheckSpec[]
  mutationCheck: CheckSpec
  mutationThreshold: number
  maxReviewRounds: number
  maxMutationRounds: number
  /** Above this, a FAILED issue stops auto-retrying and waits for `/retry`. */
  maxAttempts: number
  dryRun: boolean
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

const numeric = (env: Env, key: string, fallback: number): number => {
  const raw = env[key]
  if (raw === undefined || raw.trim().length === 0) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) throw new ConfigError(`${key} must be numeric, got "${raw}"`)
  return parsed
}

/** Parses `GITHUB_REPOSITORY` (`owner/repo`). */
export const parseRepository = (raw: string): { owner: string; repo: string } => {
  const [owner, repo] = raw.split('/')
  if (owner === undefined || repo === undefined || owner === '' || repo === '') {
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

/** Builds the pipeline config from the runner environment. */
export const loadConfig = (env: Env, repoRoot: string): PipelineConfig => {
  const { owner, repo } = parseRepository(required(env, 'GITHUB_REPOSITORY'))

  return {
    repoRoot,
    owner,
    repo,
    githubToken: required(env, 'GITHUB_TOKEN'),
    selfLogin: optional(env, 'AGENT_SELF_LOGIN', owner),
    model: optional(env, 'OPENCODE_MODEL', 'anthropic/claude-sonnet-4-5'),
    baseBranch: optional(env, 'AGENT_BASE_BRANCH', 'main'),
    commitAuthorName: optional(env, 'AGENT_COMMIT_NAME', 'opencode-agent[bot]'),
    commitAuthorEmail: optional(env, 'AGENT_COMMIT_EMAIL', 'opencode-agent@users.noreply.github.com'),
    checks: parseChecks(env['AGENT_CHECKS']),
    mutationCheck: DEFAULT_MUTATION_CHECK,
    mutationThreshold: numeric(env, 'AGENT_MUTATION_THRESHOLD', 0.6),
    maxReviewRounds: numeric(env, 'AGENT_MAX_REVIEW_ROUNDS', 3),
    maxMutationRounds: numeric(env, 'AGENT_MAX_MUTATION_ROUNDS', 2),
    maxAttempts: numeric(env, 'AGENT_MAX_ATTEMPTS', 3),
    dryRun: optional(env, 'AGENT_DRY_RUN', 'false').toLowerCase() === 'true',
  }
}
