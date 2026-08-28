// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import { resumeRun, startRun } from '../../../afk-runner/src/run.js'
import { renderGateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { buildVetoUpdaterPrompt, updateAssumptionsFromVetoes } from '../../../afk-runner/src/work/veto-updater.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

describe('veto-updater port (C4 D8)', () => {
  it('builds a prompt carrying the vetoed ids, their originals, and the redirects', () => {
    const prompt = buildVetoUpdaterPrompt({
      changeName: 'add-thing',
      assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies' }],
      findings: [{ id: 'F1', gap: 'design lacks rollback', evidence: 'searched' }],
      vetoes: [
        { id: 'A1', redirect: 'dm-only' },
        { id: 'F1', redirect: 'restructure around a helper' },
      ],
      artifacts: { proposal: 'the proposal body' },
      reportPath: '/tmp/.review-loop/veto-updater.json',
    })
    expect(prompt).toContain('add-thing')
    expect(prompt).toContain('- A1 "guests stay read-only" → dm-only')
    expect(prompt).toContain('- F1 "design lacks rollback" → restructure around a helper')
    expect(prompt).toContain('<proposal.md>')
    expect(prompt).toContain('/tmp/.review-loop/veto-updater.json')
  })

  it('updateAssumptionsFromVetoes applies redirects and marks bare vetoes in the sidecar', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-veto-'))
    const sidecarPath = path.join(dir, 'resolutions-2.json')
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'evidence-answered', outcome: 'kept' }],
        assumptions: [
          {
            id: 'A1',
            text: 'guests stay read-only',
            basis: 'code-evidence',
            confidence: 'high',
            blast_radius: 'group replies',
            status: 'open',
            evidence: { files: ['src/a.ts'] },
          },
        ],
      }),
    )
    await updateAssumptionsFromVetoes(dir, 2, [
      { id: 'A1', redirect: 'dm-only' },
      { id: 'F1', redirect: 'narrow the rollback gap' },
    ])
    const updated: {
      assumptions: { id: string; text: string; status: string }[]
      resolutions: { id: string; outcome?: string }[]
    } = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'))
    expect(updated.assumptions[0]).toMatchObject({ id: 'A1', text: 'dm-only', status: 'open' })
    expect(updated.resolutions[0]).toMatchObject({ id: 'F1', outcome: 'narrow the rollback gap' })
  })
})

describe('veto revision as draft re-entry work (integration)', () => {
  it('a veto settle re-enters draft, runs the veto-updater revision, and re-reviews the revised artifacts', async () => {
    const materialRound = {
      'findings-1.json': JSON.stringify({
        findings: [
          {
            id: 'F1',
            class: 'MATERIAL',
            gap: 'proposal lacks a rollback story',
            question: 'how do we roll back?',
            code_evidence_attempted: 'searched the repo, none found',
          },
        ],
      }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'evidence-answered', outcome: 'kept as documented' }],
        assumptions: [],
      }),
      'findings-2.json': JSON.stringify({ findings: [] }),
      'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
      'veto-updater.json': JSON.stringify({ files_updated: ['openspec/changes/add-thing/proposal.md'] }),
    }
    const pipeline = makeFakePipeline({ sidecarOverrides: materialRound })
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runDir = pipeline.runDirOf(started.runId)
    const logPath = path.join(runDir, 'events.ndjson')

    const vetoMd = renderGateAnswers({
      items: [{ kind: 'finding', id: 'F1', text: 'F1', accepted: false, redirect: 'restructure around a helper' }],
      blockerAnswers: [],
      acks: [{ id: 'T1', text: 'I reviewed the trajectory and the open findings above' }],
      decision: 'veto',
    })
    fs.writeFileSync(path.join(runDir, 'gate-1.md'), vetoMd)

    const clock = fakeClock()
    const resumedPromise = resumeRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, started.runId)
    const outcome = await settleViaTicks(resumedPromise, clock)
    expect(outcome.halted).toBe('awaiting-tail')
    expect(outcome.drove).toBe(true)

    expect(pipeline.spawnOrder).toContain('veto-updater.json')
    expect(pipeline.spawnOrder).toContain('findings-2.json')
    const tokens = eventTokens(logPath)
    // three draft enters: the original draft, the veto mover, and the
    // re-entry self-loop the bracket appends before the revision work
    expect(tokens.filter((token) => token === 'stage_enter:draft')).toHaveLength(3)
    expect(tokens).toContain('gate:answered:veto')
    expect(tokens).toContain('round_open:2')
    expect(tokens).toContain('convergence:2:converged')
  })
})

function eventTokens(logPath: string): string[] {
  return readEvents(logPath).flatMap((event) => {
    if (event.type === 'stage_enter' || event.type === 'stage_exit') return [`${event.type}:${event.stage}`]
    if (event.type === 'gate') {
      const outcome = 'outcome' in event ? (event.outcome ?? '') : ''
      return [`gate:${event.action}:${outcome}`]
    }
    if (event.type === 'round_open') return [`round_open:${event.round}`]
    if (event.type === 'convergence') return [`convergence:${event.round}:${event.verdict}`]
    return []
  })
}

/** Fake clock: each tick resolves only when the test releases it. */
function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: () => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}

/** Release one tick and let the waiter's continuation run before the next. */
async function releaseTick(clock: { readonly release: () => void }): Promise<void> {
  clock.release()
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** Release ticks (bounded) until the parked-gate resume settles and returns. */
async function settleViaTicks<T>(
  pending: Promise<T>,
  clock: { readonly release: () => void },
  budget = 10,
): Promise<T> {
  for (let i = 0; i < budget; i += 1) {
    await releaseTick(clock)
    const done = await Promise.race([pending.then((): boolean => true), Promise.resolve(false)])
    if (done) break
  }
  return pending
}
