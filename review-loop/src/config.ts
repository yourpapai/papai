// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

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
  checkCommand: z.string().min(1).default('bun check:full'),
  reviewer: AgentConfigSchema,
  fixer: AgentConfigSchema,
  matcher: AgentConfigSchema,
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
