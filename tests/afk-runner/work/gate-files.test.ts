// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { listAgentArtifacts } from '../../../afk-runner/src/work/gate-files.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-files-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('listAgentArtifacts', () => {
  it('lists the agent-authored artifacts, excluding the runner-generated views', () => {
    const changeDir = path.join(makeDir(), 'change')
    fs.mkdirSync(path.join(changeDir, 'specs', 'cap'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# why\n')
    fs.writeFileSync(path.join(changeDir, 'design.md'), '# design\n')
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# tasks\n')
    fs.writeFileSync(path.join(changeDir, 'specs', 'cap', 'spec.md'), '# spec\n')
    fs.writeFileSync(path.join(changeDir, 'review.md'), '# round 1\n')
    fs.writeFileSync(path.join(changeDir, 'assumptions.md'), '# a\n')
    expect([...listAgentArtifacts(changeDir)].sort()).toEqual([
      'design.md',
      'proposal.md',
      'specs/cap/spec.md',
      'tasks.md',
    ])
  })
})
