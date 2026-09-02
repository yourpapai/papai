// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { resumeRun } from '../../../afk-runner/src/run-resume.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { buildVetoUpdaterPrompt } from '../../../afk-runner/src/work/veto-updater.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

/** A parked ITEM-LESS final gate: one surviving nitpick declines R1, nothing else is open. */
const NITPICK_ROUND = {
  'findings-1.json': JSON.stringify({
    findings: [
      {
        id: 'F1',
        class: 'NITPICK',
        gap: 'typo in the summary',
        question: 'should this read "thing"?',
        code_evidence_attempted: 'read the proposal',
      },
    ],
  }),
  'resolutions-1.json': JSON.stringify({
    // Dismissed nitpicks stay genuinely open under the raised-vs-open split —
    // open nitpicks still converge the round but block R1's zero-open approve,
    // so the final gate stays human and parks for this veto revision flow.
    resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'kept as informational' }],
    assumptions: [],
  }),
  'findings-2.json': JSON.stringify({
    findings: [
      {
        id: 'F1',
        class: 'NITPICK',
        gap: 'typo in the summary',
        question: 'should this read "thing"?',
        code_evidence_attempted: 'read the proposal',
      },
    ],
  }),
  'resolutions-2.json': JSON.stringify({
    // Dismissed nitpicks stay genuinely open under the raised-vs-open split —
    // open nitpicks still converge the round but block R1's zero-open approve,
    // so the final gate stays human and parks for this veto revision flow.
    resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'kept as informational' }],
    assumptions: [],
  }),
  'veto-updater.json': JSON.stringify({ files_updated: ['openspec/changes/add-thing/proposal.md'] }),
}

describe('buildVetoUpdaterPrompt — whole-gate redirect section (D6)', () => {
  it('renders the whole-gate redirect as its own prompt section', () => {
    const prompt = buildVetoUpdaterPrompt({
      changeName: 'add-thing',
      assumptions: [],
      findings: [],
      vetoes: [],
      artifacts: { proposal: 'the proposal body' },
      reportPath: '/tmp/.review-loop/veto-updater.json',
      gateRedirect: 'redo the approach entirely',
    })
    expect(prompt).toContain('Whole-gate redirect')
    expect(prompt).toContain('redo the approach entirely')
  })

  it('renders an explicit no-redirect instruction for a bare gate veto', () => {
    const prompt = buildVetoUpdaterPrompt({
      changeName: 'add-thing',
      assumptions: [],
      findings: [],
      vetoes: [],
      artifacts: {},
      reportPath: '/tmp/.review-loop/veto-updater.json',
      gateRedirect: '',
    })
    expect(prompt).toContain('without a redirect')
  })

  it('omits the gate section entirely for item-only vetoes', () => {
    const prompt = buildVetoUpdaterPrompt({
      changeName: 'add-thing',
      assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies' }],
      findings: [],
      vetoes: [{ id: 'A1', redirect: 'dm-only' }],
      artifacts: {},
      reportPath: '/tmp/.review-loop/veto-updater.json',
    })
    expect(prompt).toContain('- A1 "guests stay read-only" → dm-only')
    expect(prompt).not.toContain('Whole-gate redirect')
  })

  it('no synthetic item id reaches the prompt for a gate-level veto', () => {
    const prompt = buildVetoUpdaterPrompt({
      changeName: 'add-thing',
      assumptions: [],
      findings: [],
      vetoes: [],
      artifacts: {},
      reportPath: '/tmp/.review-loop/veto-updater.json',
      gateRedirect: 'the approach is wrong',
    })
    expect(prompt).not.toMatch(/Vetoed (assumptions|findings):/u)
    expect(prompt).not.toContain('(unknown)')
    expect(prompt).not.toMatch(/- [AF]\d+ /u)
  })
})

describe('runVetoRevision consumer — gate-level veto revision (D6 integration)', () => {
  it('a settled gate-level veto with redirect runs the veto updater with the whole-gate instruction', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: NITPICK_ROUND })
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runDir = pipeline.runDirOf(started.runId)
    const logPath = path.join(runDir, 'events.ndjson')
    expect(started.halted).toBe('gate-pending')

    fs.writeFileSync(
      path.join(runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Final gate — change add-thing\n\n## Gate response\n\nVETO: redo the approach\n',
    )

    const clock = fakeClock()
    const resumed = resumeRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, started.runId)
    await ticksUntilNextGate(clock, logPath, 2)

    expect(pipeline.spawnOrder).toContain('veto-updater.json')
    const prompt = firstPromptOf(pipeline, 'veto-updater.json')
    expect(prompt).toContain('Whole-gate redirect')
    expect(prompt).toContain('redo the approach')
    expect(prompt).not.toMatch(/- [AF]\d+ /u)
    expect(readEvents(logPath).some(outcomeToken('veto'))).toBe(true)
    void resumed
  })

  it('a bare settled gate veto still runs the revision round — no-op needs vetoes-empty AND null redirect', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: NITPICK_ROUND })
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runDir = pipeline.runDirOf(started.runId)
    const logPath = path.join(runDir, 'events.ndjson')

    fs.writeFileSync(
      path.join(runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Final gate — change add-thing\n\n## Gate response\n\nVETO\n',
    )

    const clock = fakeClock()
    const resumed = resumeRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, started.runId)
    await ticksUntilNextGate(clock, logPath, 2)

    expect(pipeline.spawnOrder).toContain('veto-updater.json')
    expect(firstPromptOf(pipeline, 'veto-updater.json')).toContain('without a redirect')
    void resumed
  })
})

function firstPromptOf(pipeline: ReturnType<typeof makeFakePipeline>, basename: string): string {
  return pipeline.spawnPrompts[basename]?.[0] ?? ''
}

function outcomeToken(outcome: string): (event: SddEvent) => boolean {
  return (event) =>
    event.type === 'gate' && event.action === 'answered' && 'outcome' in event && event.outcome === outcome
}

/** Fake clock: each tick resolves only when the test releases it. */
function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: (): void => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}

/**
 * Release ticks until the run presents the given gate version and parks again — a fixed
 * tick count races the revision round's fs reads under load (the wall-clock bound keeps
 * releasing while the work is still in flight).
 */
async function ticksUntilNextGate(
  clock: { readonly release: () => void },
  logPath: string,
  version: number,
  budgetMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const presented = readEvents(logPath).some(
      (event) => event.type === 'gate' && event.action === 'presented' && event.version === version,
    )
    const updaterRan = readEvents(logPath).some(
      (event) =>
        event.type === 'stage_enter' &&
        event.stage === 'review' &&
        readEvents(logPath).some((e) => e.type === 'gate' && e.action === 'answered'),
    )
    if (presented && updaterRan) return
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
  }
}
