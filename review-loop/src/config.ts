// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { PricingTableSchema } from './cost.js'
import { detectGitRoot } from './worktree.js'

const AgentConfigSchema = z.object({
  model: z.string().min(1),
  extraArgs: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(0).optional(),
})

export const ReviewLoopConfigSchema = z.object({
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

export interface ReviewLoopConfig extends z.infer<typeof ReviewLoopConfigSchema> {
  repoRoot: string
  workDir: string
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
    repoRoot,
    workDir,
  }
}
