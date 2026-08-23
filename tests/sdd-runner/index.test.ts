// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { USAGE, readChangeSummary, runEntry } from '../../sdd-runner/src/index.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import { writeHolder } from '../../sdd-runner/src/stop-controller.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-entry-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('USAGE', () => {
  it('names the routing verb and the calm-stop verb', () => {
    expect(USAGE).toContain('sdd [<task-file> | <run-id>]')
    expect(USAGE).toContain('sdd stop [<run-id>]')
  })

  it('pins every usage line, including the blank separators', () => {
    expect(USAGE.split('\n')).toEqual([
      'sdd — autonomous SDD pipeline',
      '',
      'Usage:',
      '  sdd [<task-file> | <run-id>] [--depth S|M|L] [--pr] [--reopen [<n>]] [--config <path>]',
      '  sdd stop [<run-id>]',
      '',
      'A task file starts a run; a run id routes by its state (gate decision, resume, report).',
      'No target opens the session screen on a terminal — a loop, not a launcher: pick a run',
      '(Enter/s/r), start one from a typed description (n), and every finished action returns',
      'to the refreshed list; only an explicit quit (q) exits. Non-terminals keep the',
      'list-and-exit contract. Gate decisions: the TUI on a terminal; else hand-edit the gate file.',
    ])
  })
})

describe('readChangeSummary', () => {
  it('counts checked and unchecked task checkboxes', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '## 1\n- [x] 1.1 done\n- [ ] 1.2 todo\n')
    const summary = await readChangeSummary(dir, 'add-thing')
    expect(summary.tasksDone).toBe(1)
    expect(summary.tasksTotal).toBe(2)
  })

  it('counts only line-anchored checkboxes, indented or not, never prose mentions', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(
      path.join(changeDir, 'tasks.md'),
      '## Tasks\n  - [x] indented done\n- [ ] todo\nprose - [x] not a task\nprose - [ ] also not a task\n- [x] done\n  - [ ] indented todo\n',
    )
    const summary = await readChangeSummary(dir, 'add-thing')
    expect(summary.tasksDone).toBe(2)
    expect(summary.tasksTotal).toBe(4)
  })

  it('lists markdown artifacts recursively, ignoring non-markdown files', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# proposal\n')
    fs.writeFileSync(path.join(changeDir, 'notes.txt'), 'not markdown\n')
    fs.writeFileSync(path.join(changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    const summary = await readChangeSummary(dir, 'add-thing')
    expect([...summary.artifacts].sort()).toEqual(['proposal.md', 'spec.md'])
  })

  it('returns zero counts and no artifacts when the change is absent', async () => {
    const dir = makeDir()
    const summary = await readChangeSummary(dir, 'missing')
    expect(summary.tasksDone).toBe(0)
    expect(summary.tasksTotal).toBe(0)
    expect(summary.artifacts).toEqual([])
  })
})

describe('readChangeSummary edges (mutation kills)', () => {
  it('an uppercase X counts as checked; a missing change dir yields zeros and no artifacts', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '- [X] done uppercase\n')
    const summary = await readChangeSummary(dir, 'add-thing')
    expect(summary.tasksDone).toBe(1)
    expect(summary.tasksTotal).toBe(1)
    expect(summary.artifacts).toStrictEqual(['tasks.md'])

    const missing = await readChangeSummary(dir, 'never-created')
    expect(missing).toStrictEqual({ tasksDone: 0, tasksTotal: 0, artifacts: [] })
  })

  it('collects nested markdown artifacts only, preserving discovery of subdirectories', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'nested')
    fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'x')
    fs.writeFileSync(path.join(changeDir, 'specs', 'thing', 'spec.md'), 'x')
    fs.writeFileSync(path.join(changeDir, 'notes.txt'), 'x')
    const summary = await readChangeSummary(dir, 'nested')
    expect(summary.artifacts).toContain('proposal.md')
    expect(summary.artifacts).toContain('spec.md')
    expect(summary.artifacts).not.toContain('notes.txt')
    expect(summary.artifacts).toHaveLength(2)
  })
})

describe('runEntry --help (subprocess)', () => {
  it('prints USAGE and exits 0 for --help', () => {
    const proc = Bun.spawnSync(['bun', 'sdd-runner/src/index.ts', '--help'], {
      cwd: import.meta.dir + '/../../',
    })
    expect(proc.exitCode).toBe(0)
    const out = new TextDecoder().decode(proc.stdout)
    expect(out).toContain('sdd — autonomous SDD pipeline')
    expect(out).toContain('sdd stop [<run-id>]')
  })

  it('prints USAGE and exits 0 for -h', () => {
    const proc = Bun.spawnSync(['bun', 'sdd-runner/src/index.ts', '-h'], {
      cwd: import.meta.dir + '/../../',
    })
    expect(proc.exitCode).toBe(0)
    expect(new TextDecoder().decode(proc.stdout)).toContain('sdd — autonomous SDD pipeline')
  })

  it('an unknown flag exits non-zero with the parse error on stderr', () => {
    const proc = Bun.spawnSync(['bun', 'sdd-runner/src/index.ts', 'x.md', '--bogus'], {
      cwd: import.meta.dir + '/../../',
    })
    expect(proc.exitCode).not.toBe(0)
    const err = new TextDecoder().decode(proc.stderr)
    expect(err).toContain('unknown flag')
  })
})

describe('runEntry in-process (help route)', () => {
  it('prints USAGE to stdout and returns without exiting for --help', async () => {
    const writes: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(Buffer.from(chunk).toString())
      return true
    })
    const originalArgv = process.argv
    try {
      process.argv = ['bun', 'sdd-runner', '--help']
      writes.length = 0
      await runEntry()
      expect(writes.join('')).toContain('sdd — autonomous SDD pipeline')
    } finally {
      process.argv = originalArgv
      spy.mockRestore()
      void originalWrite
    }
  })
})

describe('runEntry wiring routes (in-process, mutation kills)', () => {
  interface EntryFixture {
    readonly repoRoot: string
    readonly workDir: string
    readonly configPath: string
    readonly writes: string[]
    readonly exitCodes: number[]
  }

  let fixture: EntryFixture | null = null
  const currentFixture = (): EntryFixture | null => fixture
  let writeSpy: { mockRestore(): void }
  let exitSpy: { mockRestore(): void }
  const saved: { argv: string[]; config: string | undefined } = { argv: [], config: undefined }

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
      exitCodes: [],
    }
  }

  beforeEach(() => {
    writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      currentFixture()?.writes.push(Buffer.from(chunk).toString())
      return true
    })
    exitSpy = spyOn(process, 'exit').mockImplementation((code?: number): never => {
      currentFixture()?.exitCodes.push(code ?? 0)
      throw new Error(`intercepted process.exit(${code ?? 0})`)
    })
  })

  afterEach(() => {
    process.argv = saved.argv
    if (saved.config === undefined) delete process.env['SDD_RUNNER_CONFIG']
    else process.env['SDD_RUNNER_CONFIG'] = saved.config
    writeSpy.mockRestore()
    exitSpy.mockRestore()
    fixture = null
  })

  async function runEntryAgainst(target: EntryFixture, args: readonly string[]): Promise<void> {
    fixture = target
    saved.argv = process.argv
    saved.config = process.env['SDD_RUNNER_CONFIG']
    process.env['SDD_RUNNER_CONFIG'] = target.configPath
    process.argv = ['bun', 'sdd', ...args]
    await runEntry()
  }

  it('a non-help argv never prints USAGE; parse errors surface before any wiring', async () => {
    const fx = makeEntryFixture()
    await expect(runEntryAgainst(fx, ['task.md', '--bogus'])).rejects.toThrow(/unknown flag/u)
    expect(fx.writes).toEqual([])
    expect(fx.exitCodes).toEqual([])
  })

  it('stop routes through the harness: marker written, pointer printed, clean exit', async () => {
    const fx = makeEntryFixture()
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(state)
    writeHolder(path.join(fx.workDir, 'runs', state.runId), process.pid)
    await expect(runEntryAgainst(fx, ['stop', state.runId, '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    expect(fs.existsSync(path.join(fx.workDir, 'runs', state.runId, 'stop-requested'))).toBe(true)
    expect(fx.writes.join('')).toBe(`calm stop requested for ${state.runId} — honored at the next boundary\n`)
    expect(fx.exitCodes).toEqual([0])
  })

  it('stop settles a dead run through the real wiring: no holder, run aborted, fresh-start pointer', async () => {
    const fx = makeEntryFixture()
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(state)
    await expect(runEntryAgainst(fx, ['stop', state.runId, '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    expect(fs.existsSync(path.join(fx.workDir, 'runs', state.runId, 'stop-requested'))).toBe(false)
    expect(fx.writes.join('')).toBe(
      `run ${state.runId} has no live process — settled as aborted · nothing to resume, start fresh: sdd <task-file>\n`,
    )
    expect((await loadRunState(fx.workDir, state.runId)).status).toBe('aborted')
    expect(fx.exitCodes).toEqual([0])
  })

  it('a completed run id builds and prints its report from the wired harness', async () => {
    const fx = makeEntryFixture()
    execFileSync('git', ['init', '-b', 'sdd-test-branch', fx.repoRoot], { stdio: 'ignore' })
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState({ ...state, status: 'completed' })
    fs.writeFileSync(path.join(fx.workDir, 'runs', state.runId, 'events.ndjson'), '')
    await expect(runEntryAgainst(fx, [state.runId, '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    const out = fx.writes.join('')
    expect(out).toContain(`run: ${state.runId}`)
    expect(out).toContain('review not reached')
    expect(out).toContain('0/0 tasks complete')
    expect(out).toContain('### Commits on sdd-test-branch')
    expect(out).toContain(`transcripts: runs/${state.runId}/transcripts/`)
    expect(fx.exitCodes).toEqual([0])
  })
})
