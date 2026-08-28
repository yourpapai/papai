// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import type { ParkedReason, WorkFor } from '../../afk-runner/src/drive/loop.js'
import { flattenPosition } from '../../afk-runner/src/drive/loop.js'
import { parkedReasonOf } from '../../afk-runner/src/drive/resume.js'
import type { SddEvent } from '../../afk-runner/src/events.js'
import { readEvents } from '../../afk-runner/src/events.js'
import { createPipelineWorkFor } from '../../afk-runner/src/graph/pipeline-work.js'
import { pipelineMachine } from '../../afk-runner/src/graph/pipeline.js'
import { toKernelEvent } from '../../afk-runner/src/kernel/fold.js'
import { initialStep, step } from '../../afk-runner/src/kernel/machine.js'
import type { KernelSnapshot } from '../../afk-runner/src/kernel/machine.js'
import { makeFakePipeline, TASK_TEXT } from './fixtures/fake-pipeline.js'

const REAL_ROOT = path.join(import.meta.dir, 'fixtures', 'real')
const SCENARIOS_ROOT = path.join(import.meta.dir, 'fixtures', 'scenarios')

function logPaths(): string[] {
  const real = readdirSync(REAL_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(REAL_ROOT, entry.name, 'events.ndjson'))
  const scenarios = readdirSync(SCENARIOS_ROOT)
    .filter((file) => file.endsWith('.ndjson'))
    .map((file) => path.join(SCENARIOS_ROOT, file))
  return [...real, ...scenarios].sort()
}

/** The real pipeline work registry over fake-agent deps — outcome readers only, work never runs here. */
function workForOf(): WorkFor {
  const pipeline = makeFakePipeline()
  return createPipelineWorkFor(
    {
      spawn: pipeline.deps.spawn,
      execGit: pipeline.deps.execGit,
      driver: pipeline.deps.driver,
      config: pipeline.deps.config,
    },
    { taskText: TASK_TEXT, changeName: 'add-thing' },
  )
}

function positionOf(snapshot: KernelSnapshot): string {
  return flattenPosition(snapshot.value)
}

/** Step one mapped event forward (tolerated events step nothing). */
function advance(snapshot: KernelSnapshot, event: SddEvent): KernelSnapshot {
  const kernelEvent = toKernelEvent(event)
  if (kernelEvent === null) return snapshot
  return step(pipelineMachine, snapshot, kernelEvent)[0]
}

/**
 * The kill -9 drill, static half (C6 D10): a crash produces an event prefix —
 * every prefix of every fixture and scenario must fold without throwing to a
 * legal machine state with a parked reason or a drivable verdict.
 */
describe('prefix property — every event prefix of the corpus folds legally (C6 D10)', () => {
  const workFor = workForOf()

  it('covers the full corpus (real hoard + scenarios)', () => {
    expect(logPaths().length).toBeGreaterThanOrEqual(21)
  })

  for (const logPath of logPaths()) {
    it(`${path.relative(path.join(import.meta.dir, '..'), logPath)}: all prefixes fold to a legal state`, () => {
      const events = readEvents(logPath)
      let snapshot = initialStep(pipelineMachine)[0]
      const verdictAt = (current: KernelSnapshot): ParkedReason | 'drivable' =>
        parkedReasonOf(current.context, positionOf(current), workFor)
      expect(['final', 'gate-pending', 'stopped', 'drivable']).toContain(verdictAt(snapshot))
      for (const event of events) {
        snapshot = advance(snapshot, event)
        expect(['final', 'gate-pending', 'stopped', 'drivable']).toContain(verdictAt(snapshot))
      }
    })
  }
})
