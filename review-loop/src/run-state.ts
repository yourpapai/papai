// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { ReviewLoopConfig } from './config.js'

export const RunStateSchema = z.object({
  runId: z.string(),
  runDir: z.string(),
  transcriptDir: z.string(),
  statePath: z.string(),
  reviewerSessionPath: z.string(),
  fixerSessionPath: z.string(),
  repoRoot: z.string(),
  planPath: z.string(),
  reviewerSessionId: z.string().nullable(),
  fixerSessionId: z.string().nullable(),
  currentRound: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
})

export type RunState = z.infer<typeof RunStateSchema>

const PersistedRunStateSchema = RunStateSchema.pick({
  runId: true,
  repoRoot: true,
  planPath: true,
  currentRound: true,
  noProgressRounds: true,
})

const SessionPointerSchema = z.object({
  sessionId: z.string().nullable(),
})

function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/gu, '-')
}

export async function createRunState(config: ReviewLoopConfig, planPath: string): Promise<RunState> {
  const runId = makeRunId()
  const runDir = path.join(config.workDir, 'runs', runId)
  const transcriptDir = path.join(runDir, 'transcripts')
  const statePath = path.join(runDir, 'state.json')
  const reviewerSessionPath = path.join(runDir, 'reviewer-session.json')
  const fixerSessionPath = path.join(runDir, 'fixer-session.json')

  await mkdir(transcriptDir, { recursive: true })

  const state: RunState = {
    runId,
    runDir,
    transcriptDir,
    statePath,
    reviewerSessionPath,
    fixerSessionPath,
    repoRoot: config.repoRoot,
    planPath,
    reviewerSessionId: null,
    fixerSessionId: null,
    currentRound: 0,
    noProgressRounds: 0,
  }

  await writeFile(reviewerSessionPath, JSON.stringify({ sessionId: null }, null, 2))
  await writeFile(fixerSessionPath, JSON.stringify({ sessionId: null }, null, 2))
  await saveRunState(state)
  return state
}

export async function loadRunState(workDir: string, runId: string): Promise<RunState> {
  const statePath = path.join(workDir, 'runs', runId, 'state.json')
  const runDir = path.dirname(statePath)
  const state = PersistedRunStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
  const reviewerSessionPath = path.join(runDir, 'reviewer-session.json')
  const fixerSessionPath = path.join(runDir, 'fixer-session.json')

  return {
    ...state,
    runDir,
    transcriptDir: path.join(runDir, 'transcripts'),
    statePath,
    reviewerSessionPath,
    fixerSessionPath,
    reviewerSessionId: await readSessionPointer(reviewerSessionPath),
    fixerSessionId: await readSessionPointer(fixerSessionPath),
  }
}

export async function saveRunState(state: RunState): Promise<void> {
  const persistedState = PersistedRunStateSchema.parse(state)
  await writeFile(state.statePath, JSON.stringify(persistedState, null, 2))
  await writeSessionPointer(state.reviewerSessionPath, state.reviewerSessionId)
  await writeSessionPointer(state.fixerSessionPath, state.fixerSessionId)
}

async function readSessionPointer(pointerPath: string): Promise<string | null> {
  return SessionPointerSchema.parse(JSON.parse(await readFile(pointerPath, 'utf8'))).sessionId
}

async function writeSessionPointer(pointerPath: string, sessionId: string | null): Promise<void> {
  await writeFile(pointerPath, JSON.stringify({ sessionId }, null, 2))
}
