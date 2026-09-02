// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { WorkIO } from '../../../afk-runner/src/drive/loop.js'
import { appendEvent, readEvents } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import { presentEarlyGate } from '../../../afk-runner/src/work/early-gate.js'
import type { ReviewLoopResult } from '../../../afk-runner/src/work/review-loop.js'

const STAMP = new Date('2026-08-27T00:00:00.000Z')

function isPresentedGateEvent(event: SddEvent): boolean {
  return event.type === 'gate' && event.action === 'presented'
}

/** A cap-hit presentation over a corrupted round sidecar: the guarded result must feed the render. */
async function presentOverCorruptSidecar(): Promise<{ readonly runDir: string; readonly logPath: string }> {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-early-gate-'))
  const changeDir = path.join(runDir, 'change')
  const sidecarDir = path.join(runDir, 'sidecars')
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.writeFileSync(path.join(sidecarDir, 'resolutions-1.json'), '{not json')
  const logPath = path.join(runDir, 'events.ndjson')
  const prelude: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
    {
      altitude: 'L2',
      type: 'convergence',
      round: 1,
      verdict: 'open',
      counts: { blocker: 0, material: 1, nitpick: 0 },
    },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
  ]
  for (const event of prelude) appendEvent(logPath, event, STAMP)
  const io: WorkIO = {
    append: (event) => appendEvent(logPath, event, STAMP),
    context: foldEvents(pipelineMachine, readEvents(logPath)).snapshot.context,
    runDir,
  }
  const result: ReviewLoopResult = {
    outcome: 'cap-hit',
    rounds: 1,
    verdict: 'open',
    raised: { blocker: 0, material: 1, nitpick: 0 },
    openBlockers: [],
    openMaterial: [{ id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'kept as documented' }],
    openNitpicks: [],
  }
  await presentEarlyGate(
    {
      agent: { config: { repoRoot: runDir, workDir: runDir, model: 'm', budget: 5 } },
      changeName: 'add-thing',
      repoRoot: runDir,
    },
    io,
    {
      sidecarDir,
      changeDir,
      logPath,
      emit: (event) => {
        appendEvent(logPath, event, STAMP)
      },
      runDir,
    },
    result,
  )
  return { runDir, logPath }
}

describe('early gate renders the substituted integrity blocker (F-C2/D3 site 2)', () => {
  it('an unparseable round sidecar renders the POLICY-INTEGRITY row at a cap-hit early gate', async () => {
    const { runDir, logPath } = await presentOverCorruptSidecar()
    const gateMd = fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')
    expect(gateMd).toContain('POLICY-INTEGRITY')
    expect(gateMd).toContain('evidence: sidecar unparseable')
    expect(gateMd).toContain('→ <answer or OVERRIDE>')
    const events = readEvents(logPath)
    const presented = events.filter(isPresentedGateEvent)
    expect(presented).toHaveLength(1)
    expect(presented[0]).toMatchObject({ mode: 'early', version: 1 })
    // no rule auto-decides over the substituted blocker
    expect(events.at(-1)).toMatchObject({ type: 'auto_decision', rule: 'none', decision: 'gate' })
  })

  it('an agreeing sidecar renders the recorded rows unchanged — the guard adds nothing', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-early-gate-clear-'))
    const changeDir = path.join(runDir, 'change')
    const sidecarDir = path.join(runDir, 'sidecars')
    fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'kept as documented' }],
        assumptions: [],
      }),
    )
    const logPath = path.join(runDir, 'events.ndjson')
    const prelude: readonly EventInput[] = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 1, nitpick: 0 },
        open: { blocker: 0, material: 1, nitpick: 0 },
      },
      { altitude: 'L2', type: 'stage_exit', stage: 'review' },
    ]
    for (const event of prelude) appendEvent(logPath, event, STAMP)
    const io: WorkIO = {
      append: (event) => appendEvent(logPath, event, STAMP),
      context: foldEvents(pipelineMachine, readEvents(logPath)).snapshot.context,
      runDir,
    }
    await presentEarlyGate(
      {
        agent: { config: { repoRoot: runDir, workDir: runDir, model: 'm', budget: 5 } },
        changeName: 'add-thing',
        repoRoot: runDir,
      },
      io,
      {
        sidecarDir,
        changeDir,
        logPath,
        emit: (event) => {
          appendEvent(logPath, event, STAMP)
        },
        runDir,
      },
      {
        outcome: 'cap-hit',
        rounds: 1,
        verdict: 'open',
        raised: { blocker: 0, material: 1, nitpick: 0 },
        openBlockers: [],
        openMaterial: [{ id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'kept as documented' }],
        openNitpicks: [],
      },
    )
    const gateMd = fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')
    expect(gateMd).toContain('- [ ] F1')
    expect(gateMd).not.toContain('POLICY-INTEGRITY')
  })
})
