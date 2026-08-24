// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runPlanBranch } from '../../sdd-runner/src/children.js'
import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { SddEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { planDigest } from '../../sdd-runner/src/plan.js'
import type { PlanChild, PlanFsDeps } from '../../sdd-runner/src/plan.js'
import { createRunState, loadRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-children-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const CHILDREN: readonly PlanChild[] = [
  { id: 'auth-db', instruction: 'Add the auth database schema.\nSecond line ignored.', deps: [] },
  { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'], capabilities: ['codeindex'] },
]

interface FakeFs {
  readonly fs: PlanFsDeps
  readonly dirs: string[]
  readonly writes: { readonly file: string; readonly data: string }[]
  readonly listed: string[]
  readonly unlinked: string[]
}

function makeFakeFs(): FakeFs {
  const dirs: string[] = []
  const writes: { file: string; data: string }[] = []
  const listed: string[] = []
  const unlinked: string[] = []
  const fsSeam: PlanFsDeps = {
    mkdir: (dir) => {
      dirs.push(dir)
      return Promise.resolve(undefined)
    },
    writeFile: (file, data) => {
      writes.push({ file, data })
      return Promise.resolve()
    },
    readdir: (dir) => {
      listed.push(dir)
      return Promise.resolve([])
    },
    unlink: (file) => {
      unlinked.push(file)
      return Promise.resolve()
    },
  }
  return { fs: fsSeam, dirs, writes, listed, unlinked }
}

interface ChildrenFixture {
  readonly repoRoot: string
  readonly state: RunState
  readonly deps: OrchestratorDeps
  readonly ctx: StageContext
}

async function makeFixture(): Promise<ChildrenFixture> {
  const repoRoot = makeDir()
  const workDir = path.join(repoRoot, '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
  const logPath = path.join(state.runDir, 'events.ndjson')
  appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
  const deps: OrchestratorDeps = {
    config: { repoRoot, workDir, model: 'test-model', budget: 5 },
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriver({
      exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
      cwd: repoRoot,
    }),
    resolveCost: () => null,
    now: () => new Date('2026-08-12T08:00:00.000Z'),
  }
  const ctx: StageContext = {
    cwd: repoRoot,
    changeDir: path.join(repoRoot, 'openspec', 'changes', 'composite'),
    sidecarDir: path.join(state.runDir, 'sidecars'),
    emit: (event) => {
      appendEvent(logPath, event)
    },
  }
  return { repoRoot, state, deps, ctx }
}

describe('runPlanBranch (D7)', () => {
  it('materializes through the injected fs seam, emits the plan event, sets and persists state, and presents the plan gate', async () => {
    const fixture = await makeFixture()
    const fake = makeFakeFs()
    const result = await runPlanBranch(fixture.deps, fixture.state, fixture.ctx, CHILDREN, { fs: fake.fs })

    expect(result.halted).toBe('gate')
    expect(result.gateMdPath).toBe(path.join(fixture.state.runDir, 'gate-1.md'))
    expect(result.version).toBe(1)

    const childrenDir = path.join(fixture.state.runDir, 'children')
    expect(fake.dirs).toEqual([childrenDir])
    expect(fake.listed).toEqual([childrenDir])
    expect(fake.writes.map((w) => w.file)).toEqual([
      path.join(childrenDir, '1-auth-db.md'),
      path.join(childrenDir, '2-auth-api.md'),
    ])
    expect(fake.writes[0]?.data).toContain('# auth-db')
    expect(fake.unlinked).toEqual([])

    const digest = planDigest(CHILDREN)
    const planEvents = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e): e is Extract<SddEvent, { type: 'plan' }> => e.type === 'plan',
    )
    expect(planEvents).toHaveLength(1)
    expect(planEvents[0]).toMatchObject({ childCount: 2, digest })

    expect(fixture.state.plan).toEqual({ childIds: ['auth-db', 'auth-api'], digest })
    expect(fixture.state.children).toEqual({
      'auth-db': { status: 'pending' },
      'auth-api': { status: 'pending' },
    })

    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.plan).toEqual({ childIds: ['auth-db', 'auth-api'], digest })
    expect(persisted.children).toEqual({
      'auth-db': { status: 'pending' },
      'auth-api': { status: 'pending' },
    })
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })

    const md = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(md).toContain('## Plan gate')
    expect(md).toContain('- [ ] C1 auth-db — Add the auth database schema.')
    expect(md).toContain('- [ ] C2 auth-api — Add the auth API endpoints. · deps: auth-db · capabilities: codeindex')

    const gateEvents = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e): e is Extract<SddEvent, { type: 'gate' }> => e.type === 'gate',
    )
    expect(gateEvents).toHaveLength(1)
    expect(gateEvents[0]).toMatchObject({ action: 'presented', mode: 'plan', version: 1 })
  })

  it('topo-reorders an unsorted plan before numbering files, ids, and the digest', async () => {
    const fixture = await makeFixture()
    const fake = makeFakeFs()
    const unsorted: readonly PlanChild[] = [
      { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'] },
      { id: 'auth-db', instruction: 'Add the auth database schema.', deps: [] },
    ]
    const result = await runPlanBranch(fixture.deps, fixture.state, fixture.ctx, unsorted, { fs: fake.fs })

    const childrenDir = path.join(fixture.state.runDir, 'children')
    expect(fake.writes.map((w) => w.file)).toEqual([
      path.join(childrenDir, '1-auth-db.md'),
      path.join(childrenDir, '2-auth-api.md'),
    ])
    expect(fixture.state.plan).toEqual({
      childIds: ['auth-db', 'auth-api'],
      digest: planDigest(unsorted.slice().reverse()),
    })
    const md = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(md).toContain('- [ ] C1 auth-db — Add the auth database schema.')
    expect(md).toContain('- [ ] C2 auth-api — Add the auth API endpoints. · deps: auth-db')
  })
})
