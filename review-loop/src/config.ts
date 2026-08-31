// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { ClaudeRunContext } from './agent-runner.js'
import { PricingTableSchema } from './cost.js'
import { detectGitRoot } from './worktree.js'

/**
 * Which subprocess backend serves the run's agent roles. One backend per run —
 * per-role placement makes a mixed config representable so validation can
 * refuse it by name, rather than a top-level key silently stripping a stray
 * per-role spelling and proceeding on the wrong backend.
 */
export type AgentBackend = 'opencode' | 'claude'

const AgentConfigSchema = z.object({
  model: z.string().min(1),
  /** The reasoning-effort tier this role's subprocess runs at (design D4); absent names none. */
  effort: z.string().optional(),
  /**
   * See {@link AgentBackend}; omit-or-agree per role, resolved run-wide. The
   * error names the received value because a bare expected-one-of message does
   * not say which knob the bad spelling came from.
   */
  backend: z
    .enum(['opencode', 'claude'], {
      error: (iss) => `backend must be "opencode" or "claude", got ${JSON.stringify(iss.input) ?? 'unknown'}`,
    })
    .optional(),
  extraArgs: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(0).optional(),
})

const ReviewLoopConfigShape = z.object({
  repoRoot: z.string().min(1).optional(),
  workDir: z.string().min(1),
  maxRounds: z.number().int().positive().default(10),
  maxNoProgressRounds: z.number().int().positive().default(2),
  agentTimeoutMs: z.number().int().min(0).default(600_000),
  buildTimeoutMs: z.number().int().min(0).default(600_000),
  /**
   * Wall clock for the **whole run**, after which the loop stops itself — as
   * opposed to `agentTimeoutMs`, which bounds one subprocess.
   *
   * `0` is no budget, and it is the default because a laptop already has the
   * bound that matters: somebody watching, who can press Ctrl-C. An unattended
   * run has neither, and the caller's own deadline arrives as a kill that takes
   * the summary, the ledger and the un-published fixes with it. See
   * `stop-controller.ts` for what the loop does with the answer.
   */
  runTimeoutMs: z.number().int().min(0).default(0),
  /**
   * Who the loop's commits are by. Absent means "whoever git already thinks",
   * which is right on a developer's machine and impossible on a bare runner —
   * see `git-identity.ts`.
   */
  commitAuthor: z.object({ name: z.string().min(1), email: z.string().min(1) }).optional(),
  checkCommand: z.string().min(1).default('bun check:full'),
  poolSize: z.number().int().positive().default(3),
  /**
   * Merge each accepted fix into the checkout as it lands, instead of once at
   * the end behind the build gate. Off by default — see `publish-fix.ts` for
   * why an unattended CI run wants it on and a laptop does not.
   */
  mergeEachFix: z.boolean().default(false),
  /**
   * Batched verification: one fixer per theme batch, one build + one inspector
   * per round over the aggregated diff. Off by default — see `issue-clustering.ts`
   * and `loop-controller.ts` batch path.
   */
  batchVerify: z.boolean().default(false),
  reviewer: AgentConfigSchema,
  fixer: AgentConfigSchema,
  inspector: AgentConfigSchema.optional(),
  matcher: AgentConfigSchema,
  pricing: PricingTableSchema.optional(),
})

/** The per-role backend spellings a config names, in role order, `undefined`s dropped. */
function namedBackends(config: {
  reviewer: { backend?: AgentBackend }
  fixer: { backend?: AgentBackend }
  matcher: { backend?: AgentBackend }
  inspector?: { backend?: AgentBackend }
}): AgentBackend[] {
  return [config.reviewer, config.fixer, config.matcher, config.inspector].flatMap((agent) =>
    agent?.backend === undefined ? [] : [agent.backend],
  )
}

/**
 * The one backend a parsed config resolves to: the single non-`undefined`
 * per-role value, else the pre-change default. Callers read this instead of
 * re-deriving it, so every spawn of the run agrees on one answer.
 */
export function effectiveBackend(config: {
  reviewer: { backend?: AgentBackend }
  fixer: { backend?: AgentBackend }
  matcher: { backend?: AgentBackend }
  inspector?: { backend?: AgentBackend }
}): AgentBackend {
  return namedBackends(config)[0] ?? 'opencode'
}

/**
 * Refuses per-role backend disagreement at load, before any subprocess starts.
 * The refinement runs after the enum has vetted each value individually.
 */
export const ReviewLoopConfigSchema = ReviewLoopConfigShape.superRefine((config, ctx) => {
  const unique = [...new Set(namedBackends(config))]
  if (unique.length > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['backend'],
      message: `Invalid config: one backend per run — every role that names a backend must agree (found ${unique.join(', ')}).`,
    })
  }
})

export interface ReviewLoopConfig extends z.infer<typeof ReviewLoopConfigSchema> {
  repoRoot: string
  workDir: string
  /** The one effective backend every role of this run spawns (D1). */
  backend: AgentBackend
  /**
   * The claude route's run-wide context, assembled once in `runCli` after the
   * resolver answers and joined with the run-scoped config-dir root (D4), and
   * ridden on the resolved config to every spawn. Absent on the opencode route.
   */
  claude?: ClaudeRunContext
}

export interface ConfigLoadInput {
  configPath: string
  repoRoot?: string
}

export async function loadReviewLoopConfig(input: ConfigLoadInput): Promise<ReviewLoopConfig> {
  const configPath = path.resolve(input.configPath)
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  const parsed = ReviewLoopConfigSchema.parse(raw)

  const repoRootSource = input.repoRoot ?? parsed.repoRoot
  const repoRoot = repoRootSource === undefined ? await detectGitRoot(process.cwd()) : path.resolve(repoRootSource)
  const workDir = path.resolve(repoRoot, parsed.workDir)

  await mkdir(workDir, { recursive: true })

  return {
    ...parsed,
    backend: effectiveBackend(parsed),
    repoRoot,
    workDir,
  }
}
