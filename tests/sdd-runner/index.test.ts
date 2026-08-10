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

  it('returns zero counts when tasks.md is absent', async () => {
    const dir = makeDir()
    const summary = await readChangeSummary(dir, 'missing')
    expect(summary.tasksDone).toBe(0)
    expect(summary.tasksTotal).toBe(0)
  })
})
