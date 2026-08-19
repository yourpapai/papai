// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { USAGE, readChangeSummary, runEntry } from '../../sdd-runner/src/index.js'

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
  it('lists the four subcommands', () => {
    expect(USAGE).toContain('start')
    expect(USAGE).toContain('resume')
    expect(USAGE).toContain('gate resume')
    expect(USAGE).toContain('report')
  })

  it('prints the full multi-line usage text', () => {
    expect(USAGE).toContain('sdd-runner — autonomous SDD pipeline')
    expect(USAGE).toContain('Usage:')
    expect(USAGE).toContain('sdd-runner start <task-file> [--depth S|M|L] [--verbosity brief|normal|debug]')
    expect(USAGE).toContain('sdd-runner continue [runId]')
    expect(USAGE).toContain('sdd-runner resume <runId>')
    expect(USAGE).toContain(
      'sdd-runner gate [resume <runId> [--confirm-all] [--extend] [--veto <id>=<redirect>]... [--abort]]',
    )
    expect(USAGE).toContain('sdd-runner report <runId> [--pr]')
    expect(USAGE).toContain('opens an interactive gate session')
    expect(USAGE).toContain('Bare `gate` lists pending gates.')
    expect(USAGE).toContain('\n')
  })

  it('pins every usage line, including the blank separators', () => {
    expect(USAGE.split('\n')).toEqual([
      'sdd-runner — autonomous SDD pipeline',
      '',
      'Usage:',
      '  sdd-runner start <task-file> [--depth S|M|L] [--verbosity brief|normal|debug]',
      '  sdd-runner continue [runId]',
      '  sdd-runner resume <runId>',
      '  sdd-runner gate [resume <runId> [--confirm-all] [--extend] [--veto <id>=<redirect>]... [--abort]]',
      '  sdd-runner report <runId> [--pr]',
      '',
      'On a terminal, `gate resume <runId>` (or `continue`) opens an interactive gate session.',
      'Without a TTY, pass decision flags or hand-edit the gate file. Bare `gate` lists pending gates.',
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
    expect(out).toContain('sdd-runner — autonomous SDD pipeline')
    expect(out).toContain('sdd-runner report <runId> [--pr]')
  })

  it('prints USAGE and exits 0 for -h', () => {
    const proc = Bun.spawnSync(['bun', 'sdd-runner/src/index.ts', '-h'], {
      cwd: import.meta.dir + '/../../',
    })
    expect(proc.exitCode).toBe(0)
    expect(new TextDecoder().decode(proc.stdout)).toContain('sdd-runner — autonomous SDD pipeline')
  })

  it('an unknown subcommand exits non-zero with the parse error on stderr', () => {
    const proc = Bun.spawnSync(['bun', 'sdd-runner/src/index.ts', 'frobnicate'], {
      cwd: import.meta.dir + '/../../',
    })
    expect(proc.exitCode).not.toBe(0)
    const err = new TextDecoder().decode(proc.stderr)
    expect(err).toContain('subcommand')
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
      expect(writes.join('')).toContain('sdd-runner — autonomous SDD pipeline')
    } finally {
      process.argv = originalArgv
      spy.mockRestore()
      void originalWrite
    }
  })
})
