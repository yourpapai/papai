// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { PersistedStatsSchema, type RunStats } from '../../review-loop/src/run-stats.js'
import type { MutationImproveConfig } from './config.js'

const MergedEntrySchema = z.object({
  file: z.string(),
  beforeScore: z.number(),
  afterScore: z.number(),
  iter: z.number().int(),
  // Carried by entries stored before the runner stopped mandating documents.
  specPath: z.string().optional(),
  planPath: z.string().optional(),
  // Why a file was accepted below target, in the form the runner set-matched
  // against its own surviving mutant ids. This is what the end-of-run report
  // renders; it used to render two links to prose no gate ever read.
  residuals: z
    .array(z.object({ loc: z.string(), why: z.string(), mutantIds: z.array(z.string()).optional() }))
    .optional(),
  // true when the iteration merged below threshold at its declared residual
  // ceiling (outcome 'capped'); absent/false on fully-threshold-passing merges.
  capped: z.boolean().optional(),
})

const FailedEntrySchema = z.object({
  iter: z.number().int(),
  file: z.string().optional(),
  gate: z.string(),
  reason: z.string(),
})

export const PersistedRunStateSchema = z.object({
  runId: z.string(),
  repoRoot: z.string(),
  base: z.string(),
  threshold: z.number(),
  count: z.number().int(),
  currentIteration: z.number().int().nonnegative(),
  doneSet: z.array(z.string()),
  merged: z.array(MergedEntrySchema),
  failed: z.array(FailedEntrySchema),
  status: z.enum(['running', 'completed', 'aborted']),
  stats: PersistedStatsSchema.optional(),
})

export type PersistedRunState = z.infer<typeof PersistedRunStateSchema>

export interface MutationImproveRunState extends PersistedRunState {
  runDir: string
  workDir: string
  statePath: string
}

function makeRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
}

export function iterDir(runDir: string, iter: number): string {
  return path.join(runDir, 'iter', String(iter))
}

export async function createRunState(config: MutationImproveConfig): Promise<MutationImproveRunState> {
  const runId = makeRunId()
  const runDir = path.join(config.workDir, 'runs', runId)
  await mkdir(runDir, { recursive: true })
  const state: MutationImproveRunState = {
    runId,
    runDir,
    workDir: config.workDir,
    statePath: path.join(runDir, 'state.json'),
    repoRoot: config.repoRoot,
    base: config.base,
    threshold: config.threshold,
    count: config.count,
    currentIteration: 0,
    doneSet: [],
    merged: [],
    failed: [],
    status: 'running',
  }
  await saveRunState(state)
  return state
}

export async function loadRunState(workDir: string, runId: string): Promise<MutationImproveRunState> {
  const runDir = path.join(workDir, 'runs', runId)
  const statePath = path.join(runDir, 'state.json')
  const persisted = PersistedRunStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
  return { ...persisted, runDir, workDir, statePath }
}

export async function saveRunState(state: MutationImproveRunState): Promise<void> {
  const persisted = PersistedRunStateSchema.parse(state)
  await writeFile(state.statePath, JSON.stringify(persisted, null, 2))
}

export function persistStats(state: MutationImproveRunState, stats: RunStats): void {
  state.stats = stats.persist()
}
