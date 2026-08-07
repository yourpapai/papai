// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { PricingTableSchema } from '../../review-loop/src/cost.js'
import { detectGitRoot } from '../../review-loop/src/worktree.js'

const AgentConfigSchema = z.object({
  model: z.string().min(1),
  extraArgs: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(0).default(1_800_000),
})

export const MutationImproveConfigSchema = z.object({
  repoRoot: z.string().min(1).optional(),
  workDir: z.string().min(1),
  base: z.string().min(1).default('master'),
  upstream: z.string().min(1).default('origin'),
  count: z.number().int().positive().default(1),
  threshold: z.number().min(0).max(1).default(0.95),
  epsilon: z.number().min(0).max(1).default(0.02),
  mutateTimeoutMs: z.number().int().min(0).default(1_800_000),
  buildTimeoutMs: z.number().int().min(0).default(1_800_000),
  // A failed checkCommand does not fail the iteration outright: the runner feeds
  // the check output back to the agent and re-gates, this many times (0 = legacy
  // fail-fast). Agent-authored files regularly trip format:check; retrying
  // recovers that work instead of discarding it.
  buildFixAttempts: z.number().int().min(0).default(2),
  // Serial (CI=true) gate: `bun test --parallel` flakes with 15s timeouts under
  // worker contention, which would randomly discard completed agent work.
  checkCommand: z.string().min(1).default('CI=true bun check:full'),
  mutateFileCommand: z.string().min(1).default('bun test:mutate:file'),
  agent: AgentConfigSchema,
  prBranchPrefix: z.string().min(1).default('mutation-improve'),
  pricing: PricingTableSchema.optional(),
})

export interface MutationImproveConfig extends z.infer<typeof MutationImproveConfigSchema> {
  repoRoot: string
  workDir: string
}

export interface ConfigLoadInput {
  configPath: string
  repoRoot?: string
}

// repoRoot may legitimately resolve to a subdirectory of the target repo (e.g.
// "repoRoot": "." in mutation-improve/config.json, where `bun run --filter`
// sets the cwd to the package dir). Snap it to the git toplevel so baseline,
// worktree, and merge operations target the real repo; non-git roots (tests,
// ad-hoc dirs) pass through unchanged.
async function snapToGitRoot(resolved: string): Promise<string> {
  try {
    return await detectGitRoot(resolved)
  } catch {
    return resolved
  }
}

export async function loadMutationImproveConfig(input: ConfigLoadInput): Promise<MutationImproveConfig> {
  const configPath = path.resolve(input.configPath)
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  const parsed = MutationImproveConfigSchema.parse(raw)

  const repoRootSource = input.repoRoot ?? parsed.repoRoot
  const resolved = repoRootSource === undefined ? await detectGitRoot(process.cwd()) : path.resolve(repoRootSource)
  const repoRoot = await snapToGitRoot(resolved)
  const workDir = path.resolve(repoRoot, parsed.workDir)

  await mkdir(workDir, { recursive: true })

  return { ...parsed, repoRoot, workDir }
}
