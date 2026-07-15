// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

const AgentConfigSchema = z.object({
  model: z.string().min(1),
  extraArgs: z.array(z.string()).default([]),
})

export const ReviewLoopConfigSchema = z.object({
  repoRoot: z.string().min(1),
  workDir: z.string().min(1),
  maxRounds: z.number().int().positive().default(10),
  maxNoProgressRounds: z.number().int().positive().default(2),
  checkCommand: z.string().min(1).default('bun check:full'),
  reviewer: AgentConfigSchema,
  fixer: AgentConfigSchema,
  matcher: AgentConfigSchema,
})

export type ReviewLoopConfig = z.infer<typeof ReviewLoopConfigSchema>

export interface ConfigLoadInput {
  configPath: string
  repoRoot?: string
}

export async function loadReviewLoopConfig(input: ConfigLoadInput): Promise<ReviewLoopConfig> {
  const configPath = path.resolve(input.configPath)
  const configDir = path.dirname(configPath)
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  const parsed = ReviewLoopConfigSchema.parse(raw)

  const repoRoot =
    input.repoRoot === undefined ? path.resolve(configDir, parsed.repoRoot) : path.resolve(input.repoRoot)
  const workDir = path.resolve(repoRoot, parsed.workDir)

  await mkdir(workDir, { recursive: true })

  return {
    ...parsed,
    repoRoot,
    workDir,
  }
}
