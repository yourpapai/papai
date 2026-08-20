// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { z } from 'zod'

import { ConfigError } from './config-values.js'
import type { Env } from './config-values.js'

/**
 * The two settings that are **discovered** rather than read.
 *
 * `config-values.ts` is about how one scalar is read out of the environment and
 * which values are refused; `config.ts` is about which values a run needs. These
 * two fit neither, and they are the same shape as each other: a value with no
 * defensible literal fallback, resolved by asking the checkout and the event in
 * order, reporting "not configured" or failing by name rather than guessing.
 * Both learned that the hard way — a baked-in review path reported every run
 * outside this repository as permanently red, and a `main` default killed every
 * run inside it, whose default branch is `master`.
 *
 * They probe the world, so both take the probe as an argument: an `exists` and a
 * `fromGit`, injected the way every other boundary in this workspace is, which
 * is what lets the resolution ladders be tested without a filesystem or a
 * remote. Split out of `config.ts` when it went past `max-lines`; the seam was
 * already there, since these are the only two functions in it that ask anything
 * outside the environment.
 */

/** This repository's own review-loop workspace, when the checkout has one. */
const REVIEW_LOOP_ENTRY = 'review-loop/src/cli.ts'

/** The directory whose presence makes this checkout OpenSpec-compliant (D10). */
const OPENSPEC_ROOT = 'openspec'

/**
 * The two answers the `openspec/` root probe can return — design D10.
 *
 * `compliant` is the ordinary mode in a repo that has adopted OpenSpec; the
 * reworked pipeline runs. `stand-down` is the fail-closed posture for a foreign
 * repo without an `openspec/` tree: the agent posts one clear comment naming the
 * remedy (e.g. `openspec init`) and does no work, because every artefact path in
 * the compliant pipeline assumes that tree exists. The agent never scaffolds
 * OpenSpec into a repo that has not adopted it.
 */
export type OpenSpecMode = { readonly mode: 'compliant' } | { readonly mode: 'stand-down'; readonly reason: string }

/** The comment the stand-down door posts, kept beside the verdict it explains. */
export const STAND_DOWN_REASON =
  'This repository has no `openspec/` tree, so the agent cannot run its OpenSpec-compliant pipeline. Run `openspec init` (or adopt OpenSpec) to enable it; until then the agent is standing down.'

/**
 * Resolves whether this checkout is OpenSpec-compliant.
 *
 * Same testable ladder shape as {@link resolveReviewCommand}: an injected
 * `exists` callback keeps the probe testable without a filesystem, and the path
 * is checked at the repo root only — a nested `openspec/` (say, under `src/`)
 * is a different directory and must not satisfy the probe.
 */
export const resolveOpenSpecMode = (repoRoot: string, exists: (filePath: string) => boolean): OpenSpecMode =>
  exists(path.join(repoRoot, OPENSPEC_ROOT)) ? { mode: 'compliant' } : { mode: 'stand-down', reason: STAND_DOWN_REASON }

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
 * Both callers already know it — the webhook payload carries
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
