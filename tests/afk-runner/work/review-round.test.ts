// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Resolution } from '../../../afk-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import { EventInputSchema } from '../../../afk-runner/src/events.js'
import type { EventInput } from '../../../afk-runner/src/events.js'
import type { ReviewLoopDeps, ReviewLoopOptions } from '../../../afk-runner/src/work/review-loop.js'
import { closeRound } from '../../../afk-runner/src/work/review-round.js'
import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-review-round-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

interface RoundFixture {
  readonly deps: ReviewLoopDeps
  readonly options: ReviewLoopOptions
  readonly emitted: EventInput[]
  readonly materializeSawConcerns: boolean[]
}

function makeRoundFixture(dir: string): RoundFixture {
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nimprove things\n')
  fs.writeFileSync(path.join(changeDir, 'design.md'), '## Context\nhow\n')
  fs.writeFileSync(
    path.join(changeDir, 'specs', 'thing', 'spec.md'),
    '## ADDED Requirements\n### Requirement: X\n\nIt SHALL x.\n',
  )
  const emitted: EventInput[] = []
  const materializeSawConcerns: boolean[] = []
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'test-model',
    budget: 5,
  }
  const spawn: SpawnFn = () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  const sidecarDir = path.join(dir, 'sidecars')
  const deps: ReviewLoopDeps = {
    agent: {
      spawn,
      config,
      execGit: (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '', stderr: '' }),
      emit: () => undefined,
    },
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    sidecarDir,
    runDir: dir,
    cwd: dir,
    materialize: () => {
      // Pin the ordering from the materialize side: by the time it runs, the
      // concerns sidecar of a PREVIOUS round exists, this round's not yet.
      materializeSawConcerns.push(fs.existsSync(path.join(sidecarDir, 'concerns.json')))
      return Promise.resolve()
    },
  }
  const options: ReviewLoopOptions = {
    changeName: 'add-thing',
    changeDir,
    depth: 'M',
    taskText: 'x',
    conventions: 'y',
  }
  return { deps, options, emitted, materializeSawConcerns }
}

function resolutions(...entries: readonly Partial<Resolution>[]): Resolution[] {
  return entries.map((entry) => ({
    id: 'F1',
    class: 'NITPICK',
    resolution: 'edited',
    outcome: 'fixed',
    ...entry,
  }))
}

describe('closeRound — concern sidecar (loop-memory D5)', () => {
  it('writes sidecars/concerns.json after materialize and before round_close, returning the history', async () => {
    const dir = makeDir()
    const fixture = makeRoundFixture(dir)
    // Seed round 1's sidecars so round 2's close has history to persist.
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-1.json'),
      JSON.stringify({
        resolutions: resolutions({ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }),
        assumptions: [],
      }),
    )
    fs.writeFileSync(
      path.join(sidecarDir, 'findings-1.json'),
      JSON.stringify({
        findings: [
          {
            id: 'F1',
            class: 'MATERIAL',
            gap: 'the proposal never names the scope id',
            question: 'q',
            code_evidence_attempted: 'e',
          },
        ],
      }),
    )
    const closed = await closeRound(
      fixture.deps,
      fixture.options,
      { resolutions: resolutions({ id: 'F2' }), assumptions: [] },
      [],
      2,
      3,
    )
    // The sidecar exists by the time round_close is emitted.
    const closeIndex = fixture.emitted.findIndex((event) => event.type === 'round_close')
    const concernsPath = path.join(sidecarDir, 'concerns.json')
    expect(closeIndex).toBeGreaterThanOrEqual(0)
    expect(fs.existsSync(concernsPath)).toBe(true)
    // The recorded history covers the round-1 concern, fingerprint-grouped.
    expect(closed.concernHistory).toHaveLength(1)
    expect(closed.concernHistory[0]?.firstRound).toBe(1)
    expect(closed.concernHistory[0]?.lastRound).toBe(1)
    // Materialize ran before the concerns write existed for THIS round (first call, fresh dir had none).
    expect(fixture.materializeSawConcerns[0]).toBe(false)
  })

  it('a pre-concerns.json sidecar dir reads as no history', async () => {
    const dir = makeDir()
    const fixture = makeRoundFixture(dir)
    const closed = await closeRound(
      fixture.deps,
      fixture.options,
      { resolutions: resolutions({ id: 'F1' }), assumptions: [] },
      [],
      1,
      3,
    )
    expect(closed.concernHistory).toEqual([])
    const written: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'concerns.json'), 'utf8'))
    expect(written).toEqual([])
  })
})
