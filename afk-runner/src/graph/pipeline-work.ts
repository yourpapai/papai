// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import type { ExecGitFn, RunnerConfig } from '../config.js'
import type { StateModule, WorkFor, WorkIO } from '../drive/loop.js'
import type { DepthProfile, EventInput } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import type { OpenSpecDriver } from '../openspec-driver.js'
import { runDraft } from '../work/draft.js'
import { parseGateResponse } from '../work/gate-model.js'
import { expectedContentFor } from '../work/gate-settle.js'
import { runIntake } from '../work/intake.js'
import { reviewOutcomeOf, runReviewWork } from '../work/review.js'
import { runVetoUpdater, updateAssumptionsFromVetoes } from '../work/veto-updater.js'

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
 * edits. Tail states (decompose/atomicity) declare no work and the loop
 * parks awaiting-tail instead of entering them; `gate.awaiting` (C4) is the
 * positional park of a presented gate — no work, parks gate-pending until a
 * settle producer answers through the seam.
 */
/** A settled veto re-enters draft: the gate is answered with outcome veto (design D8). */
function isVetoRevision(context: KernelContext): boolean {
  return context.gate !== null && context.gate.answered && context.gateOutcome === 'veto'
}

/**
 * The veto-updater revision round (C4 D8): read the vetoes from the settled
 * gate file, fold them back into the resolver sidecar, and run one resolver
 * pass that applies the redirects to the existing artifacts.
 */
async function runVetoRevision(deps: PipelineWorkDeps, input: PipelineRunInput, io: WorkIO): Promise<void> {
  const runDir = io.runDir
  const sidecarDir = path.join(runDir, 'sidecars')
  const version = io.context.gate?.version ?? 1
  const round = io.context.round?.current ?? 1
  const gateMode = io.context.gate?.mode === 'early' ? 'early' : 'final'
  const md = await fs.promises.readFile(path.join(runDir, `gate-${version}.md`), 'utf8')
  const expected = await expectedContentFor(sidecarDir, round, gateMode)
  const response = parseGateResponse(md, expected)
  if (response.vetoes.length === 0) return
  await updateAssumptionsFromVetoes(sidecarDir, round, response.vetoes)
  await runVetoUpdater(
    {
      driver: deps.driver,
      agent: {
        spawn: deps.spawn,
        config: deps.config,
        execGit: deps.execGit,
        emit: (event) => {
          io.append(event)
        },
      },
      runDir,
      sidecarDir,
      cwd: deps.config.repoRoot,
    },
    { changeName: input.changeName, round, vetoes: response.vetoes },
  )
}

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
            isVetoRevision(io.context)
              ? runVetoRevision(deps, input, io)
              : runDraft(
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
        successors: {
          converged: { enter: 'decompose' },
          'cap-hit': { park: 'gate-pending' },
          // The round still owes work — an extended round opened by a gate
          // settle, a crashed mid-round, a fresh entry: review re-runs itself.
          incomplete: { enter: 'review' },
        },
      }
    }
    if (state === 'gate.awaiting') {
      return {
        work: null,
        outcomeOf: () => 'awaiting',
        successors: { awaiting: { park: 'gate-pending' } },
      }
    }
    return null
  }
}
