// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import type { WorkIO } from '../../../afk-runner/src/drive/loop.js'
import { appendEvent, readEvents } from '../../../afk-runner/src/events.js'
import type { EventInput } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { presentFinalGate } from '../../../afk-runner/src/work/present-final.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-present-final-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const DEPTH_M = { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'two modules', source: 'estimator' } as const

/** Walk a log to the point where the tail's last stage owes the presentation. */
function seedWalkToAtomicity(
  runDir: string,
  extra: readonly EventInput[] = [],
  options: { readonly unknownCost?: boolean } = {},
): void {
  const logPath = path.join(runDir, 'events.ndjson')
  if (options.unknownCost === true) {
    // R4 fail-closed: tokens burned at zero known cost blocks auto-approve —
    // the ladder hands the gate to the human.
    appendEvent(logPath, {
      altitude: 'L1',
      type: 'done',
      agent: 'reviewer-r1',
      model: 'test-model',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0,
        wallMs: 5,
      },
    })
  }
  for (const event of [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    DEPTH_M,
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 3 },
    {
      altitude: 'L2',
      type: 'convergence',
      round: 1,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 0 },
    },
    { altitude: 'L2', type: 'round_close', round: 1, cap: 3 },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
    ...extra,
    { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
    { altitude: 'L2', type: 'stage_exit', stage: 'decompose' },
    { altitude: 'L2', type: 'stage_enter', stage: 'atomicity' },
  ] as const) {
    appendEvent(logPath, event)
  }
}

interface PresenterFixture {
  readonly runDir: string
  readonly changeDir: string
  readonly io: WorkIO
  readonly appended: EventInput[]
  readonly fileStateAtEnter: { gateMd: boolean; hashes: boolean }[]
}

function makeFixture(seed: (runDir: string) => void): PresenterFixture {
  const runDir = makeDir()
  seed(runDir)
  const repoRoot = runDir
  const changeDir = path.join(repoRoot, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'proposal\n')
  const appended: EventInput[] = []
  const fileStateAtEnter: { gateMd: boolean; hashes: boolean }[] = []
  const logPath = path.join(runDir, 'events.ndjson')
  const context = (): KernelContext => foldEvents(pipelineMachine, readEvents(logPath)).snapshot.context
  const io: WorkIO = {
    append: (event) => {
      if (event.type === 'stage_enter') {
        fileStateAtEnter.push({
          gateMd: fs.existsSync(path.join(runDir, `gate-1.md`)),
          hashes: fs.existsSync(path.join(runDir, `gate-hashes-1.json`)),
        })
      }
      appended.push(event)
      return appendEvent(logPath, event)
    },
    context: context(),
    runDir,
  }
  return { runDir, changeDir, io, appended, fileStateAtEnter }
}

const CONFIG: RunnerConfig = { repoRoot: '/repo', workDir: '/work', model: 'm', budget: 5 }

function typeTokens(events: readonly EventInput[]): string[] {
  return events.map((event) => `${event.type}${'stage' in event ? `:${event.stage}` : ''}`)
}

describe('presentFinalGate — the tail last work act (C5 D1/D2)', () => {
  it('renders the gate file and hashes sidecar first, then stage_enter(gate), presented final v1, ladder', async () => {
    const fixture = makeFixture((runDir) => seedWalkToAtomicity(runDir, [], { unknownCost: true }))
    const result = await presentFinalGate(
      { config: CONFIG, repoRoot: fixture.runDir, changeName: 'add-thing' },
      fixture.io,
    )
    expect(result.version).toBe(1)
    expect(fixture.fileStateAtEnter).toEqual([{ gateMd: true, hashes: true }])
    expect(typeTokens(fixture.appended)).toEqual(['stage_enter:gate', 'gate', 'auto_decision'])
    const presented = fixture.appended.find((event) => event.type === 'gate')
    expect(presented).toMatchObject({ action: 'presented', mode: 'final', version: 1 })
    const ladder = fixture.appended.find((event) => event.type === 'auto_decision')
    expect(ladder).toMatchObject({ gateVersion: 1, decision: 'gate' })
    const snapshot = foldEvents(pipelineMachine, readEvents(path.join(fixture.runDir, 'events.ndjson'))).snapshot
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    expect(snapshot.context.gate).toEqual({ mode: 'final', version: 1, answered: false })
  })

  it('presents at max-version+1 when the run already presented gates', async () => {
    const fixture = makeFixture((runDir) =>
      seedWalkToAtomicity(runDir, [
        { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 },
        { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'approve' },
      ]),
    )
    const result = await presentFinalGate(
      { config: CONFIG, repoRoot: fixture.runDir, changeName: 'add-thing' },
      fixture.io,
    )
    expect(result.version).toBe(2)
    const presented = fixture.appended.find((event) => event.type === 'gate')
    expect(presented).toMatchObject({ action: 'presented', mode: 'final', version: 2 })
    expect(fs.existsSync(path.join(fixture.runDir, 'gate-2.md'))).toBe(true)
    expect(fs.existsSync(path.join(fixture.runDir, 'gate-hashes-2.json'))).toBe(true)
  })
})
