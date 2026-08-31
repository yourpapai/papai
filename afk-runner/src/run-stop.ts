// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { autonomyOf, deriveChangeName } from './config.js'
import type { RunnerConfig } from './config.js'
import { createAppendBoundary } from './drive/boundary.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldRun, logPathOf, writeRunMemo } from './memo-project.js'
import type { MemoSeed } from './memo-project.js'
import { loadRunState } from './run-state.js'
import { requestCalmStop, runHasLiveOwner } from './stop-controller.js'

/** The deps slice the stop verb needs (the full RunDeps shape works structurally). */
export interface StopDeps {
  readonly config: RunnerConfig
  readonly now?: () => Date
}

export type OperatorStop =
  | { readonly kind: 'calm-requested'; readonly runId: string }
  | { readonly kind: 'aborted'; readonly runId: string }
  | { readonly kind: 'gate-pending'; readonly runId: string }
  | { readonly kind: 'final'; readonly runId: string; readonly position: string }

/**
 * The operator give-up path (C6 D7): a live owner gets the calm-stop marker
 * (the machinery's first producer — honored at the next boundary, parks
 * resumable); a gate-pending run points at steer abort (no new surface); a
 * dead or parked run appends `run_abort`, reaches the aborted final, writes
 * the terminal memo, and releases the session id through TERMINAL_STATUSES.
 */
export async function stopRunOperator(deps: StopDeps, runId: string): Promise<OperatorStop> {
  const runDir = path.join(deps.config.workDir, 'runs', runId)
  const logPath = logPathOf(runDir)
  const folded = foldRun(logPath)
  if (folded.position === 'completed' || folded.position === 'aborted') {
    return { kind: 'final', runId, position: folded.position }
  }
  const gate = folded.context.gate
  if (folded.position === 'gate.awaiting' && gate !== null && !gate.answered) {
    return { kind: 'gate-pending', runId }
  }
  if (runHasLiveOwner(runDir)) {
    requestCalmStop(runDir)
    return { kind: 'calm-requested', runId }
  }
  const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
  boundary.append({ altitude: 'L2', type: 'run_abort', reason: 'operator' })
  const after = foldRun(logPath)
  const changeName = await changeNameOfRun(deps, runId, runDir)
  const seed = seedOf(deps, runId, changeName, folded.createdAt)
  await writeRunMemo(seed, 'final', after.position, after.context, logPath)
  return { kind: 'aborted', runId }
}

/** The memo is read opportunistically for the change name only; a missing memo derives it from the run's task.md. */
async function changeNameOfRun(deps: StopDeps, runId: string, runDir: string): Promise<string> {
  try {
    return (await loadRunState(deps.config.workDir, runId)).changeName
  } catch {
    return deriveChangeName('task.md', await readFile(path.join(runDir, 'task.md'), 'utf8'))
  }
}

function seedOf(deps: StopDeps, runId: string, changeName: string, createdAt: string | null): MemoSeed {
  return {
    runId,
    workDir: deps.config.workDir,
    repoRoot: deps.config.repoRoot,
    changeName,
    createdAt: createdAt ?? (deps.now?.() ?? new Date()).toISOString(),
    metered: autonomyOf(deps.config).metered,
  }
}
