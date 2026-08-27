// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runGateResume } from '../../sdd-runner/src/gate-resume-entry.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState, saveRunState } from '../../sdd-runner/src/run-state.js'

describe('gate-resume entry', () => {
  it('rejects a run that is not gate-pending', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-entry-'))
    const workDir = path.join(dir, 'work')
    const state = await createRunState({ workDir, repoRoot: dir, changeName: 'thing' })
    await saveRunState(state)
    await expect(
      runGateResume(
        {
          config: { repoRoot: dir, workDir, model: 'm', budget: 5 },
          spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
          execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
          driver: createOpenSpecDriver({
            exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
            cwd: dir,
          }),
        },
        state.runId,
        {},
      ),
    ).rejects.toThrow(/not gate-pending/u)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('keeps extend-round free of a dynamic orchestrator import (D7: the cycle stays one-way without a dynamic import)', () => {
    const srcPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'sdd-runner',
      'src',
      'extend-round.ts',
    )
    const src = fs.readFileSync(srcPath, 'utf8')
    expect(src).not.toContain("import('./orchestrator.js')")
  })

  it('forwards the full PlanChild into runStart instead of discarding it (D6 pass-through)', () => {
    const srcPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'sdd-runner',
      'src',
      'gate-resume-entry.ts',
    )
    const src = fs.readFileSync(srcPath, 'utf8')
    expect(src).toContain('runStart(deps, { child, taskFile, spendBaselineUsd, onRunDirReady })')
  })
})
