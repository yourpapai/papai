// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { SessionTargetAction } from '../../sdd-runner/src/session-flow.js'
import { writeHolder } from '../../sdd-runner/src/stop-controller.js'

/**
 * index.ts's session-loop wiring (sessionLoopOf / sessionFlowDepsOf) has no
 * seam of its own: it exists to connect cli.ts's sessionLoop contract to the
 * real orchestrator entry points, the real gate reopen, and the real
 * remove/stop seams. The module mocks here replace exactly the boundaries
 * the wiring connects — the picker it drives and the orchestrator/gate-resume
 * verbs it forwards to — so the wiring itself stays the real code under test.
 *
 * Registration happens in `beforeEach` and the real modules are re-registered
 * in `afterEach`, never at module scope: the mutation runner imports every
 * paired test file eagerly into one process, so a top-level `mock.module`
 * would stub the orchestrator for every other suite in that process. The
 * mocks are live for exactly the duration of this file's own tests.
 */

type OrchestratorModule = typeof import('../../sdd-runner/src/orchestrator.js')
type GateResumeEntryModule = typeof import('../../sdd-runner/src/gate-resume-entry.js')
type PickerModule = typeof import('../../sdd-runner/src/tui-session-picker.js')

const ORCHESTRATOR_SPECIFIER = '../../sdd-runner/src/orchestrator.js'
const GATE_RESUME_ENTRY_SPECIFIER = '../../sdd-runner/src/gate-resume-entry.js'
const PICKER_SPECIFIER = '../../sdd-runner/src/tui-session-picker.js'

/** Real exports captured by value: a `mock.module` patch can mutate the captured namespace in place. */
let realOrchestratorFns: Pick<OrchestratorModule, 'runStart' | 'runResume' | 'runContinue'> | null = null
let realGateResumeFn: GateResumeEntryModule['runGateResume'] | null = null
let realPickerFn: PickerModule['runSessionPicker'] | null = null

const orchestratorCalls: { verb: string; args: unknown[] }[] = []
const startOptions: unknown[] = []
const pickerCalls: {
  workDir: string
  initial: 'list' | 'create' | undefined
  execute: (action: SessionTargetAction) => Promise<void>
  createRun: (taskText: string) => Promise<void>
}[] = []

function installMocks(): void {
  void mock.module(ORCHESTRATOR_SPECIFIER, () => ({
    runStart: (_deps: unknown, options: unknown): Promise<{ runId: string }> => {
      startOptions.push(options)
      return Promise.resolve({ runId: 'fresh-run' })
    },
    runResume: (_deps: unknown, runId: string): Promise<{ runId: string }> => {
      orchestratorCalls.push({ verb: 'runResume', args: [runId] })
      return Promise.resolve({ runId })
    },
    runContinue: (_deps: unknown, runId: string | null): Promise<{ runId: string | null }> => {
      orchestratorCalls.push({ verb: 'runContinue', args: [runId] })
      return Promise.resolve({ runId })
    },
  }))
  void mock.module(GATE_RESUME_ENTRY_SPECIFIER, () => ({
    runGateResume: (_deps: unknown, runId: string): Promise<{ runId: string }> => {
      orchestratorCalls.push({ verb: 'runGateResume', args: [runId] })
      return Promise.resolve({ runId })
    },
  }))
  void mock.module(PICKER_SPECIFIER, () => ({
    runSessionPicker: (deps: {
      workDir: string
      initial?: 'list' | 'create'
      execute: (action: SessionTargetAction) => Promise<void>
      createRun: (taskText: string) => Promise<void>
    }): Promise<'quit'> => {
      pickerCalls.push({
        workDir: deps.workDir,
        initial: deps.initial,
        execute: deps.execute,
        createRun: deps.createRun,
      })
      return Promise.resolve('quit')
    },
  }))
}

function restoreRealModules(): void {
  const orchestratorFns = realOrchestratorFns
  const gateResumeFn = realGateResumeFn
  const pickerFn = realPickerFn
  if (orchestratorFns !== null) void mock.module(ORCHESTRATOR_SPECIFIER, () => orchestratorFns)
  if (gateResumeFn !== null) void mock.module(GATE_RESUME_ENTRY_SPECIFIER, () => ({ runGateResume: gateResumeFn }))
  if (pickerFn !== null) void mock.module(PICKER_SPECIFIER, () => ({ runSessionPicker: pickerFn }))
}

type EntryModule = typeof import('../../sdd-runner/src/index.js')
let entry: EntryModule | null = null
async function loadEntry(): Promise<EntryModule> {
  entry ??= await import('../../sdd-runner/src/index.js')
  return entry
}

beforeAll(async () => {
  const orchestrator: OrchestratorModule = await import('../../sdd-runner/src/orchestrator.js')
  realOrchestratorFns = {
    runStart: orchestrator.runStart,
    runResume: orchestrator.runResume,
    runContinue: orchestrator.runContinue,
  }
  const gateResumeEntry: GateResumeEntryModule = await import('../../sdd-runner/src/gate-resume-entry.js')
  realGateResumeFn = gateResumeEntry.runGateResume
  const picker: PickerModule = await import('../../sdd-runner/src/tui-session-picker.js')
  realPickerFn = picker.runSessionPicker
})

afterAll(restoreRealModules)

const tmpDirs: string[] = []
function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-session-loop-'))
  tmpDirs.push(dir)
  return dir
}

interface EntryFixture {
  readonly repoRoot: string
  readonly workDir: string
  readonly configPath: string
  readonly writes: string[]
}

function makeEntryFixture(): EntryFixture {
  const dir = makeDir()
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ repoRoot: dir, workDir: '.sdd-runner', model: 'test-model', budget: 5 }),
  )
  return {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    configPath: path.join(dir, 'config.json'),
    writes: [],
  }
}

let fixture: EntryFixture | null = null
const currentFixture = (): EntryFixture | null => fixture
let writeSpy: { mockRestore(): void }
let exitSpy: { mockRestore(): void }
const saved: { argv: string[]; config: string | undefined; stdinTty: PropertyDescriptor | undefined } = {
  argv: [],
  config: undefined,
  stdinTty: undefined,
}

beforeEach(() => {
  orchestratorCalls.length = 0
  startOptions.length = 0
  pickerCalls.length = 0
  installMocks()
  writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    currentFixture()?.writes.push(Buffer.from(chunk).toString())
    return true
  })
  exitSpy = spyOn(process, 'exit').mockImplementation((code?: number): never => {
    throw new Error(`intercepted process.exit(${code ?? 0})`)
  })
  saved.stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
})

afterEach(() => {
  process.argv = saved.argv
  if (saved.config === undefined) delete process.env['SDD_RUNNER_CONFIG']
  else process.env['SDD_RUNNER_CONFIG'] = saved.config
  if (saved.stdinTty === undefined) Reflect.deleteProperty(process.stdin, 'isTTY')
  else Object.defineProperty(process.stdin, 'isTTY', saved.stdinTty)
  writeSpy.mockRestore()
  exitSpy.mockRestore()
  restoreRealModules()
  fixture = null
})

async function runEntryAgainst(target: EntryFixture, args: readonly string[]): Promise<void> {
  fixture = target
  saved.argv = process.argv
  saved.config = process.env['SDD_RUNNER_CONFIG']
  process.env['SDD_RUNNER_CONFIG'] = target.configPath
  process.argv = ['bun', 'sdd', ...args]
  const { runEntry } = await loadEntry()
  await runEntry().catch((error: unknown) => {
    if (!(error instanceof Error) || !/^intercepted process\.exit\(/u.test(error.message)) throw error
  })
}

type RunStateLike = import('../../sdd-runner/src/run-state.js').RunState

async function seedRun(
  workDir: string,
  runId: string,
  mutate: (state: RunStateLike) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  const state = await createRunState({ workDir, repoRoot: workDir, changeName: runId, runId })
  await mutate(state)
}

async function errorMessageOf(maybe: Promise<unknown> | undefined): Promise<string> {
  if (maybe === undefined) throw new Error('expected the picker seam to exist')
  const failure = await maybe.catch((error: unknown) => error)
  if (!(failure instanceof Error)) throw new Error('expected the promise to reject with an Error')
  return failure.message
}

describe('runEntry session-loop wiring (interactive)', () => {
  it('a terminal with no runs opens the picker on the creation screen', async () => {
    const fx = makeEntryFixture()
    await runEntryAgainst(fx, [])
    expect(pickerCalls).toHaveLength(1)
    expect(pickerCalls[0]?.initial).toBe('create')
    expect(pickerCalls[0]?.workDir).toBe(fx.workDir)
  })

  it('a terminal with a routable run opens the picker on the list screen', async () => {
    const fx = makeEntryFixture()
    await seedRun(fx.workDir, 'done-run', async (state) => {
      await saveRunState({ ...state, status: 'completed' })
    })
    await runEntryAgainst(fx, [])
    expect(pickerCalls).toHaveLength(1)
    expect(pickerCalls[0]?.initial).toBeUndefined()
  })

  it('the creation seam starts a run with the typed text and carries the --depth override', async () => {
    const fx = makeEntryFixture()
    await runEntryAgainst(fx, ['--depth', 'L'])
    const picker = pickerCalls[0]
    expect(picker).toBeDefined()
    await picker?.createRun('# Fresh thing\n\nbody\n')
    expect(startOptions).toStrictEqual([{ taskText: '# Fresh thing\n\nbody\n', depthOverride: 'L' }])
    expect(fx.writes.join('')).toContain('started fresh-run')
  })

  it('the creation seam starts without a depth override when none was given', async () => {
    const fx = makeEntryFixture()
    await runEntryAgainst(fx, [])
    await pickerCalls[0]?.createRun('plain text\n')
    expect(startOptions).toStrictEqual([{ taskText: 'plain text\n' }])
  })

  it('gate and resume decisions forward to the orchestrator verbs with the resolved id', async () => {
    const fx = makeEntryFixture()
    await seedRun(fx.workDir, 'gate-run')
    await seedRun(fx.workDir, 'resume-run')
    await runEntryAgainst(fx, [])
    const picker = pickerCalls[0]
    await picker?.execute({ kind: 'gate', runId: 'gate-run' })
    await picker?.execute({ kind: 'resume', runId: 'resume-run' })
    expect(orchestratorCalls).toEqual([
      { verb: 'runGateResume', args: ['gate-run'] },
      { verb: 'runResume', args: ['resume-run'] },
    ])
  })

  it('a stop decision routes through the liveness-aware stop seam and prints its message', async () => {
    const fx = makeEntryFixture()
    await seedRun(fx.workDir, 'done-sibling', async (state) => {
      await saveRunState({ ...state, status: 'completed' })
    })
    await seedRun(fx.workDir, 'live-run')
    writeHolder(path.join(fx.workDir, 'runs', 'live-run'), process.pid)
    await runEntryAgainst(fx, [])
    await pickerCalls[0]?.execute({ kind: 'stop', runId: 'live-run' })
    expect(fs.existsSync(path.join(fx.workDir, 'runs', 'live-run', 'stop-requested'))).toBe(true)
    expect(fx.writes.join('')).toContain('calm stop requested for live-run')
  })

  it('a reopen decision re-presents the latest settled gate and resumes it', async () => {
    const fx = makeEntryFixture()
    await seedRun(fx.workDir, 'settled-run', async (state) => {
      const gateMd = ['<!-- gate-1.md -->', '', '## Final gate — change settled-run', '', '## Gate response', ''].join(
        '\n',
      )
      fs.writeFileSync(path.join(state.runDir, 'gate-1.md'), `${gateMd}\n`)
      const events: EventInput[] = [
        { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 },
        { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1 },
      ]
      for (const event of events) appendEvent(path.join(state.runDir, 'events.ndjson'), event)
      fs.mkdirSync(path.join(fx.repoRoot, 'openspec', 'changes', 'settled-run'), { recursive: true })
      fs.writeFileSync(path.join(fx.repoRoot, 'openspec', 'changes', 'settled-run', 'proposal.md'), '# Why\nx\n')
      await saveRunState({ ...state, status: 'completed' })
    })
    await runEntryAgainst(fx, [])
    await pickerCalls[0]?.execute({ kind: 'reopen', runId: 'settled-run' })

    const state = await loadRunState(fx.workDir, 'settled-run')
    expect(state.gate).toEqual({ mode: 'final', version: 2 })
    expect(fs.existsSync(path.join(state.runDir, 'gate-2.md'))).toBe(true)
    expect(orchestratorCalls).toEqual([{ verb: 'runGateResume', args: ['settled-run'] }])
  })

  it('a reopen decision without a settled gate fails naming what is missing', async () => {
    const fx = makeEntryFixture()
    await seedRun(fx.workDir, 'done-sibling', async (state) => {
      await saveRunState({ ...state, status: 'completed' })
    })
    await seedRun(fx.workDir, 'never-gated', (state) => {
      appendEvent(path.join(state.runDir, 'events.ndjson'), {
        altitude: 'L2',
        type: 'stage_enter',
        stage: 'draft',
      })
      return Promise.resolve()
    })
    await runEntryAgainst(fx, [])
    const message = await errorMessageOf(pickerCalls[0]?.execute({ kind: 'reopen', runId: 'never-gated' }))
    expect(message).toBe('run never-gated has no settled gate to reopen')
  })

  it('a delete decision removes a dead run and reports it', async () => {
    const fx = makeEntryFixture()
    await seedRun(fx.workDir, 'dead-run', async (state) => {
      await saveRunState({ ...state, status: 'aborted' })
    })
    await runEntryAgainst(fx, [])
    await pickerCalls[0]?.execute({ kind: 'delete', runId: 'dead-run' })
    expect(fs.existsSync(path.join(fx.workDir, 'runs', 'dead-run'))).toBe(false)
    expect(fx.writes.join('')).toContain('run dead-run deleted')
  })

  it('a report decision builds and prints the run report', async () => {
    const fx = makeEntryFixture()
    execFileSync('git', ['init', '-b', 'sdd-test-branch', fx.repoRoot], { stdio: 'ignore' })
    await seedRun(fx.workDir, 'report-run', async (state) => {
      await saveRunState({ ...state, status: 'completed' })
      fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')
    })
    await runEntryAgainst(fx, [])
    await pickerCalls[0]?.execute({ kind: 'report', runId: 'report-run' })
    const out = fx.writes.join('')
    expect(out).toContain('run: report-run')
    expect(out).toContain('### Commits on sdd-test-branch')
  })
})

describe('runEntry help (in-process)', () => {
  it('-h prints USAGE without any harness or picker work', async () => {
    const fx = makeEntryFixture()
    await runEntryAgainst(fx, ['-h'])
    expect(fx.writes.join('')).toContain('sdd — autonomous SDD pipeline')
    expect(pickerCalls).toHaveLength(0)
  })
})
