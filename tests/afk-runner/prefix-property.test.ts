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
import { foldEvents } from '../../afk-runner/src/kernel/fold.js'
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

function foldPrefix(prefix: readonly SddEvent[]): ReturnType<typeof foldEvents>['snapshot'] {
  return foldEvents(pipelineMachine, prefix).snapshot
}

function positionOf(snapshot: ReturnType<typeof foldEvents>['snapshot']): string {
  return flattenPosition(snapshot.value)
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
      for (let cut = 0; cut <= events.length; cut += 1) {
        const prefix = events.slice(0, cut)
        const snapshot = foldPrefix(prefix)
        const verdict: ParkedReason | 'drivable' = parkedReasonOf(snapshot.context, positionOf(snapshot), workFor)
        expect(['final', 'gate-pending', 'stopped', 'drivable']).toContain(verdict)
      }
    })
  }
})
