// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import type { ExecGitFn, RunnerConfig } from '../config.js'
import type { StateModule, WorkFor, WorkIO } from '../drive/loop.js'
import type { DepthProfile, EventInput } from '../events.js'
import type { OpenSpecDriver } from '../openspec-driver.js'
import { runDraft } from '../work/draft.js'
import { runIntake } from '../work/intake.js'
import { reviewOutcomeOf, runReviewWork } from '../work/review.js'

export interface PipelineWorkDeps {
  readonly spawn: SpawnFn
  readonly execGit: ExecGitFn
  readonly driver: OpenSpecDriver
  readonly config: RunnerConfig
  readonly conventions?: string
  readonly stdout?: (line: string) => void
  /** Calm-stop seam consulted by the review loop between rounds. */
  readonly stop?: { readonly stopRequested: () => boolean }
}

export interface PipelineRunInput {
  readonly taskText: string
  readonly changeName: string
  readonly depthOverride?: DepthProfile
}

/**
 * The pipeline's state modules: work declarations co-located with the
 * outcome→successor data (design D3). The drive loop consumes only this
 * registry — adding C5's tail states means adding modules here, not loop
 * edits. Tail states (decompose/atomicity/gate) declare no work yet and the
 * loop parks awaiting-tail instead of entering them.
 */
export function createPipelineWorkFor(deps: PipelineWorkDeps, input: PipelineRunInput): WorkFor {
  const repoRoot = deps.config.repoRoot
  const sidecarDirFor = (io: WorkIO): string => path.join(io.runDir, 'sidecars')
  return (state): StateModule | null => {
    if (state === 'start') {
      return { work: null, outcomeOf: () => 'boot', successors: { boot: { enter: 'intake' } } }
    }
    if (state === 'intake') {
      return {
        work: {
          kind: 'intake',
          run: (io) =>
            runIntake(
              {
                driver: deps.driver,
                agent: {
                  spawn: deps.spawn,
                  config: deps.config,
                  execGit: deps.execGit,
                  emit: (event: EventInput): void => {
                    io.append(event)
                  },
                },
                emit: (event: EventInput): void => {
                  io.append(event)
                },
                sidecarDir: sidecarDirFor(io),
                runDir: io.runDir,
                cwd: repoRoot,
              },
              { changeName: input.changeName, taskText: input.taskText, depthOverride: input.depthOverride },
            ).then(() => undefined),
        },
        outcomeOf: (context) => (context.depth === null ? 'incomplete' : 'done'),
        successors: { done: { enter: 'draft' } },
      }
    }
    if (state === 'draft') {
      return {
        work: {
          kind: 'draft',
          run: (io) =>
            runDraft(
              {
                driver: deps.driver,
                agent: {
                  spawn: deps.spawn,
                  config: deps.config,
                  execGit: deps.execGit,
                  emit: (event: EventInput): void => {
                    io.append(event)
                  },
                },
                runDir: io.runDir,
                sidecarDir: sidecarDirFor(io),
                cwd: repoRoot,
              },
              { changeName: input.changeName, taskText: input.taskText, depth: io.context.depth ?? 'S' },
            ),
        },
        outcomeOf: (context) => (context.stages['draft'] === 'done' ? 'done' : 'incomplete'),
        successors: { done: { enter: 'review' } },
      }
    }
    if (state === 'review') {
      return {
        work: {
          kind: 'review',
          run: (io) =>
            runReviewWork(
              {
                agent: { spawn: deps.spawn, config: deps.config, execGit: deps.execGit },
                repoRoot,
                changeName: input.changeName,
                taskText: input.taskText,
                conventions: deps.conventions ?? '',
                ...(deps.stop === undefined ? {} : { stop: deps.stop }),
                ...(deps.stdout === undefined
                  ? {}
                  : { onSteerWarning: (line: string) => deps.stdout?.(`steer: ${line}`) }),
              },
              io,
            ).then(() => undefined),
        },
        outcomeOf: reviewOutcomeOf,
        successors: { converged: { enter: 'decompose' }, 'cap-hit': { park: 'gate-pending' } },
      }
    }
    return null
  }
}
