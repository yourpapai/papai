// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { RunChildRun } from '../../sdd-runner/src/child-settle.js'
import type { RunGateResumeResult } from '../../sdd-runner/src/extend-round.js'
import { runGateResume } from '../../sdd-runner/src/gate-resume-entry.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { StartOptions } from '../../sdd-runner/src/orchestrator.js'
import type { PlanChild } from '../../sdd-runner/src/plan.js'
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

  // Asserted behaviorally, not as source text: the mutation runner copies this suite into a
  // sandbox where `gate-resume-entry.ts` is the INSTRUMENTED mutant-laden file, so a literal
  // `toContain('runStart(deps, { child, ... })')` fails on the rewritten call expression and
  // aborts the whole paired run's dry run. Mocking the two boundaries the wiring connects
  // (plan-gate seam in, runStart out) keeps the entry itself as the real code under test and
  // still fails the moment the child stops being forwarded. Registration and restore stay
  // inside this test: the mutation runner imports every paired test file into one process,
  // so a leaked patch would stub the orchestrator for the other suites in that process.
  it('forwards the full PlanChild into runStart instead of discarding it (D6 pass-through)', async () => {
    const orchestratorSpecifier = '../../sdd-runner/src/orchestrator.js'
    const planGateResumeSpecifier = '../../sdd-runner/src/plan-gate-resume.js'
    // Capture by value BEFORE patching: Bun's mock.module mutates the module namespace in
    // place, so a namespace captured earlier already carries the mock by restore time, and a
    // factory returning that namespace object does not patch at all. Restoring with a fresh
    // object of the captured functions is the only form that takes effect (pinned by the
    // index-session-loop restore pattern).
    const realRunStart = (await import('../../sdd-runner/src/orchestrator.js')).runStart
    const realRunPlanGateResume = (await import('../../sdd-runner/src/plan-gate-resume.js')).runPlanGateResume

    const startCalls: StartOptions[] = []
    const child: PlanChild = {
      id: 'db-api',
      instruction: 'Rename the API route helpers.',
      deps: ['db-schema'],
      changeName: 'nested',
    }
    const onRunDirReady = (): void => {}
    const startChildRunInvoked: unknown[] = []

    try {
      void mock.module(orchestratorSpecifier, () => ({
        runStart: (_deps: unknown, options: StartOptions): Promise<{ runId: string }> => {
          startCalls.push(options)
          return Promise.resolve({ runId: 'child-run' })
        },
      }))
      void mock.module(planGateResumeSpecifier, () => ({
        runPlanGateResume: async (
          _deps: unknown,
          _state: unknown,
          _options: unknown,
          _emit: unknown,
          seams: { readonly startChildRun: RunChildRun },
        ): Promise<RunGateResumeResult> => {
          startChildRunInvoked.push(await seams.startChildRun(child, 'tasks/plan.md', 1.5, onRunDirReady))
          return { runId: 'parent', outcome: 'approved', version: 1 }
        },
      }))
      const entry = await import('../../sdd-runner/src/gate-resume-entry.js')

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-entry-d6-'))
      const workDir = path.join(dir, 'work')
      const state = await createRunState({ workDir, repoRoot: dir, changeName: 'thing' })
      state.gate = { mode: 'plan', version: 1 }
      await saveRunState(state)
      await entry.runGateResume(
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
      )
      fs.rmSync(dir, { recursive: true, force: true })
    } finally {
      void mock.module(orchestratorSpecifier, () => ({ runStart: realRunStart }))
      void mock.module(planGateResumeSpecifier, () => ({ runPlanGateResume: realRunPlanGateResume }))
    }

    expect(startChildRunInvoked).toEqual([{ runId: 'child-run' }])
    expect(startCalls.length).toBe(1)
    expect(startCalls.at(0)?.child).toBe(child)
    expect(startCalls.at(0)?.taskFile).toBe('tasks/plan.md')
    expect(startCalls.at(0)?.spendBaselineUsd).toBe(1.5)
    expect(startCalls.at(0)?.onRunDirReady).toBe(onRunDirReady)
  })
})
