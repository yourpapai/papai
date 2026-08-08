// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Raised when the environment cannot produce a runnable configuration. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** The runner environment, as this workspace reads it. */
export type Env = Record<string, string | undefined>

/**
 * Reading one scalar out of the environment, and refusing the values that
 * cannot work.
 *
 * Split from `config.ts` when the token budget's range pushed that file past
 * `max-lines`. The seam was already implied: this file is about *how* a value is
 * read and validated, `config.ts` about *which* values a run needs.
 *
 * The rule these share is worth stating once. Rejecting non-integers only closes
 * "not a number", never "a number that cannot work" — so every numeric knob is
 * range-checked, and no range's upper bound may be so large that setting it
 * quietly removes the bound the knob exists to impose.
 */

export const required = (env: Env, key: string): string => {
  const value = env[key]
  if (value === undefined || value.trim().length === 0) {
    throw new ConfigError(`Missing required environment variable ${key}`)
  }
  return value.trim()
}

/** A knob whose absence is meaningful, rather than something to default. */
export const optionalOrNull = (env: Env, key: string): string | null => {
  const value = env[key]
  return value === undefined || value.trim().length === 0 ? null : value.trim()
}

export const optional = (env: Env, key: string, fallback: string): string => {
  const value = env[key]
  return value === undefined || value.trim().length === 0 ? fallback : value.trim()
}

/**
 * A knob's accepted range.
 *
 * Both ends carry weight. Rejecting non-integers only closes "not a number",
 * never "a number that cannot work", and the difference is not academic:
 * `AGENT_TIMEOUT_MS=1` is a positive integer that kills every subprocess after a
 * millisecond, so the pipeline reports every check as failing and every model
 * call as dead; `AGENT_REVIEW_MAX_ROUNDS=9007199254740991` is a positive integer
 * that removes the very bound the knob exists to impose. Both used to load.
 */
export interface IntRange {
  min: number
  max: number
}

/** Loop counters. Generous — the ceiling is there to stay finite, not to ration. */
export const ROUND_RANGE: IntRange = { min: 1, max: 20 }

/**
 * One second to two hours. Under a second no real command completes, and an
 * Actions job is near its own ceiling well before two hours of one subprocess.
 */
export const TIMEOUT_RANGE: IntRange = { min: 1_000, max: 7_200_000 }

/**
 * Bounds on one commit. Generous enough for a real feature and its tests, small
 * enough that a staged `node_modules`, a downloaded fixture or a build directory
 * stops the run instead of landing in a public pull request.
 */
export const FILES_RANGE: IntRange = { min: 1, max: 5_000 }
export const LINES_RANGE: IntRange = { min: 1, max: 1_000_000 }

/** Concurrent `opencode run` subprocesses one runner can actually serve. */
export const POOL_RANGE: IntRange = { min: 1, max: 16 }

/**
 * Model tokens one issue may spend across every job it runs.
 *
 * The floor is a phase's worth of work, so a value that can only ever fail is
 * rejected at load rather than on the first prompt. The ceiling is high enough
 * to mean "effectively unlimited" while still being a number — this file's rule
 * is that no knob may be set to a value that quietly removes the bound it
 * exists to impose.
 */
export const TOKEN_RANGE: IntRange = { min: 50_000, max: 1_000_000_000 }

/**
 * Longest prefix accepted, and it is not arbitrary: GitHub caps a label name at
 * 50 characters, and the longest suffix in `presentation.ts` is `implementing`.
 */
const PREFIX_MAX_LENGTH = 32

/**
 * Characters a label name may carry here.
 *
 * Deliberately narrower than GitHub's own rules. A prefix is compared with
 * `startsWith` to decide which of an issue's labels this pipeline owns and may
 * remove, so it has to be a plain, predictable string — a comma splits a label
 * list in half of GitHub's own UI, and leading or trailing whitespace makes two
 * labels that look identical.
 */
const PREFIX_PATTERN = /^[\w\-./: ]+$/u

/**
 * Reads the label namespace, or `null` when labelling is switched off.
 *
 * Same shape as `AGENT_REVIEW_COMMAND`, and for the same reason: this pipeline
 * runs in repositories with their own label conventions, so a hardcoded
 * `agent:` set is exactly the papai-specific hardcoding S2-4 was re-opened for.
 * `none` disables the channel outright rather than making an operator find a
 * prefix nothing collides with.
 *
 * The value is validated at load, where a bad one is a message naming the
 * variable, rather than at the first API call, where it is a 422 inside a
 * best-effort path that swallows it.
 */
export const labelPrefix = (env: Env, key: string, fallback: string): string | null => {
  const configured = optional(env, key, fallback)
  if (configured.toLowerCase() === 'none') return null

  if (configured.length > PREFIX_MAX_LENGTH) {
    throw new ConfigError(`${key} must be at most ${PREFIX_MAX_LENGTH} characters, got ${configured.length}`)
  }
  if (!PREFIX_PATTERN.test(configured)) {
    throw new ConfigError(`${key} may only contain letters, digits and \`-_./: \`, got ${JSON.stringify(configured)}`)
  }
  return configured
}

/** Reads an integer knob, rejecting both malformed values and unusable ones. */
export const boundedInt = (env: Env, key: string, fallback: number, range: IntRange): number => {
  const raw = env[key]
  if (raw === undefined || raw.trim().length === 0) return fallback

  const trimmed = raw.trim()
  const parsed = Number.parseInt(trimmed, 10)
  // The round-trip rejects what `parseInt` would otherwise salvage a prefix
  // from — `2.5`, `1e3`, `01`, `7 rounds`.
  if (!Number.isSafeInteger(parsed) || String(parsed) !== trimmed) {
    throw new ConfigError(`${key} must be an integer, got ${JSON.stringify(raw)}`)
  }
  if (parsed < range.min || parsed > range.max) {
    throw new ConfigError(`${key} must be between ${range.min} and ${range.max}, got ${parsed}`)
  }
  return parsed
}

/** Parses `AGENT_CHECKS` — a JSON array of `{ name, argv }`. */
