// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

export const AgentRoleSchema = z.enum([
  'drafter',
  'reviewer',
  'skeptic',
  'resolver',
  'estimator',
  'decomposer',
  'atomicity',
])
export type AgentRole = z.infer<typeof AgentRoleSchema>

export const RunnerConfigSchema = z.object({
  repoRoot: z.string().min(1),
  workDir: z.string().min(1).default('.sdd-runner'),
  model: z.string().min(1),
  models: z.partialRecord(AgentRoleSchema, z.string().min(1)).default({}),
  timeouts: z
    .object({
      wallClockMs: z.number().int().positive().default(1_800_000),
      inactivityMs: z.number().int().positive().default(600_000),
    })
    .default({ wallClockMs: 1_800_000, inactivityMs: 600_000 }),
  budgetUsd: z.number().positive().optional(),
})

export interface RunnerConfig extends Omit<z.infer<typeof RunnerConfigSchema>, 'workDir'> {
  readonly workDir: string
}

export async function loadRunnerConfig(configPath: string): Promise<RunnerConfig> {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (error) {
    throw new Error(`runner config not found: ${configPath}`, { cause: error })
  }
  let parsed: z.infer<typeof RunnerConfigSchema>
  try {
    parsed = RunnerConfigSchema.parse(JSON.parse(raw))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`runner config invalid at ${configPath}: ${detail}`, { cause: error })
  }
  const workDir = path.resolve(parsed.repoRoot, parsed.workDir)
  await mkdir(workDir, { recursive: true })
  return { ...parsed, workDir }
}

export function modelFor(config: RunnerConfig, role: AgentRole): string {
  return config.models[role] ?? config.model
}

export function deriveChangeName(taskFileName: string, taskFileContent: string): string {
  const heading = taskFileContent.match(/^#\s+(.+)$/mu)?.[1]
  const base = heading ?? path.basename(taskFileName).replace(/\.[^.]*$/u, '')
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
    .replace(/-+$/u, '')
  if (slug.length === 0) {
    throw new Error(`cannot derive a change name from task file ${taskFileName}`)
  }
  return slug
}

export type ExecGitFn = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

export async function discoverBranch(execGit: ExecGitFn, repoRoot: string): Promise<string> {
  const { stdout } = await execGit(repoRoot, ['branch', '--show-current'])
  const branch = stdout.trim()
  if (branch.length === 0) {
    throw new Error('cannot discover the current branch (detached HEAD?) — report needs a branch git log')
  }
  return branch
}
