// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { USAGE, readChangeSummary } from '../../sdd-runner/src/index.js'

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
