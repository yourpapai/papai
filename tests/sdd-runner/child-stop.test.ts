// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { propagateChildStop } from '../../sdd-runner/src/child-stop.js'
import type { PlanChild } from '../../sdd-runner/src/plan.js'
import { createStopMarkerSeam, requestCalmStop, stopMarkerPath } from '../../sdd-runner/src/stop-controller.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-childstop-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const CHILD: PlanChild = { id: 'auth-db', instruction: 'Add the schema.', deps: [] }

describe('propagateChildStop (D11)', () => {
  it('writes the child stop marker while in flight when the parent stop is requested', async () => {
    const parentDir = makeDir()
    const childDir = makeDir()
    const stop = createStopMarkerSeam(parentDir)
    let onReady: ((runDir: string) => void) | undefined
    const flight = propagateChildStop(
      {
        runChildRun: async (_child, _taskFile, _baseline, ready) => {
          onReady = ready
          await new Promise((resolve) => {
            setTimeout(resolve, 60)
          })
          return { runId: 'child-run' }
        },
        stop,
      },
      CHILD,
      'task.md',
      0,
    )
    await new Promise((resolve) => {
      setTimeout(resolve, 5)
    })
    expect(onReady).toBeDefined()
    onReady?.(childDir)
    requestCalmStop(parentDir)
    await flight
    expect(fs.existsSync(stopMarkerPath(childDir))).toBe(true)
    expect(stop.requested()).toBe('marker')
  })

  it('propagates immediately when the parent marker predates the run-dir registration', async () => {
    const parentDir = makeDir()
    const childDir = makeDir()
    requestCalmStop(parentDir)
    const stop = createStopMarkerSeam(parentDir)
    await propagateChildStop(
      {
        runChildRun: (_child, _taskFile, _baseline, ready) => {
          ready?.(childDir)
          return Promise.resolve({ runId: 'child-run' })
        },
        stop,
      },
      CHILD,
      'task.md',
      0,
    )
    expect(fs.existsSync(stopMarkerPath(childDir))).toBe(true)
  })

  it('notifies onChildRunDir when the child run dir becomes known', async () => {
    const parentDir = makeDir()
    const childDir = makeDir()
    const stop = createStopMarkerSeam(parentDir)
    const seen: string[] = []
    await propagateChildStop(
      {
        runChildRun: (_child, _taskFile, _baseline, ready) => {
          ready?.(childDir)
          return Promise.resolve({ runId: 'child-run' })
        },
        stop,
        onChildRunDir: (runDir) => {
          seen.push(runDir)
        },
      },
      CHILD,
      'task.md',
      0,
    )
    expect(seen).toEqual([childDir])
  })

  it('never writes a child marker when no parent stop is requested during the flight', async () => {
    const parentDir = makeDir()
    const childDir = makeDir()
    const stop = createStopMarkerSeam(parentDir)
    await propagateChildStop(
      {
        runChildRun: (_child, _taskFile, _baseline, ready) => {
          ready?.(childDir)
          return Promise.resolve({ runId: 'child-run' })
        },
        stop,
      },
      CHILD,
      'task.md',
      0,
    )
    expect(fs.existsSync(stopMarkerPath(childDir))).toBe(false)
  })

  it('does not rewrite the child marker after the child consumes it mid-flight', async () => {
    const parentDir = makeDir()
    const childDir = makeDir()
    const stop = createStopMarkerSeam(parentDir)
    await propagateChildStop(
      {
        runChildRun: async (_child, _taskFile, _baseline, ready) => {
          ready?.(childDir)
          requestCalmStop(parentDir)
          expect(await waitFor(() => fs.existsSync(stopMarkerPath(childDir)))).toBe(true)
          fs.rmSync(stopMarkerPath(childDir))
          await new Promise((resolve) => {
            setTimeout(resolve, 120)
          })
          return { runId: 'child-run' }
        },
        stop,
      },
      CHILD,
      'task.md',
      0,
    )
    expect(fs.existsSync(stopMarkerPath(childDir))).toBe(false)
  })
})

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
  return condition()
}
