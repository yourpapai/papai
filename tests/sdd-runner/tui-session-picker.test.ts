// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock } from 'bun:test'

import type { RemoveRunResult } from '../../sdd-runner/src/remove-run.js'
import type { SessionTargetAction } from '../../sdd-runner/src/session-flow.js'
import type { SessionRow } from '../../sdd-runner/src/session-list.js'
import { runSessionPicker } from '../../sdd-runner/src/tui-session-picker.js'

const CR = '\r'
const DOWN = '\u001b[B'
const ESC = '\u001b'

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    runId: 'fix-flaky-auth-test',
    changeName: 'fix-flaky-auth-test',
    status: 'running',
    stage: 'review',
    depth: 'M',
    round: 2,
    roundCap: 3,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    costKnown: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    pendingDecision: null,
    ...overrides,
  }
}

const COMPLETED: SessionRow = row({
  runId: 'usage-failure-queries',
  changeName: 'usage-failure-queries',
  status: 'completed',
})

const ROWS: readonly SessionRow[] = [
  row(),
  row({
    runId: 'papai-settings-cleanup',
    changeName: 'papai-settings-cleanup',
    pendingDecision: { kind: 'gate', mode: 'early', version: 2 },
  }),
  COMPLETED,
]

interface PickerOptions {
  readonly keyScript: string
  readonly rows?: () => readonly SessionRow[]
  readonly initial?: 'list' | 'create'
  readonly executeImpl?: (action: SessionTargetAction) => Promise<void>
  readonly reportImpl?: (runId: string) => Promise<string>
  readonly createImpl?: (taskText: string) => Promise<void>
  readonly removeImpl?: (runId: string) => Promise<RemoveRunResult>
}

function picker(options: PickerOptions): { readonly events: string[]; readonly result: Promise<'quit'> } {
  const events: string[] = []
  const rowsOf = options.rows ?? ((): readonly SessionRow[] => ROWS)
  const result = runSessionPicker({
    listRows: (): Promise<readonly SessionRow[]> => {
      events.push('list')
      return Promise.resolve(rowsOf())
    },
    ...(options.initial === undefined ? {} : { initial: options.initial }),
    keyScript: options.keyScript,
    execute: (action: SessionTargetAction): Promise<void> => {
      events.push(`exec:${action.kind}:${action.runId}`)
      return (options.executeImpl ?? ((): Promise<void> => Promise.resolve()))(action)
    },
    buildReport: (runId: string): Promise<string> => {
      events.push(`report:${runId}`)
      return (options.reportImpl ?? ((): Promise<string> => Promise.resolve(`# report of ${runId}`)))(runId)
    },
    createRun: (taskText: string): Promise<void> => {
      events.push(`create:${JSON.stringify(taskText)}`)
      return (options.createImpl ?? ((): Promise<void> => Promise.resolve()))(taskText)
    },
    removeRun: (runId: string): Promise<RemoveRunResult> => {
      events.push(`remove:${runId}`)
      return (
        options.removeImpl ??
        ((): Promise<RemoveRunResult> => Promise.resolve({ kind: 'removed', runId: 'usage-failure-queries' }))
      )(runId)
    },
  })
  return { events, result }
}

describe('runSessionPicker loop (scripted keys)', () => {
  it('quit is the only exit: an exhausted script quits after an action, actions do not exit', async () => {
    const run = picker({ keyScript: 's' })
    await expect(run.result).resolves.toBe('quit')
    expect(run.events).toEqual(['list', 'exec:stop:fix-flaky-auth-test', 'list'])
  })

  it('re-reads rows between iterations, so actions see refreshed state', async () => {
    const rowsFn = mock((): readonly SessionRow[] => [row({ status: 'completed' })])
      .mockReturnValueOnce([row()])
      .mockReturnValueOnce([row({ status: 'completed' })])
    const run = picker({ keyScript: 'srq', rows: rowsFn })
    await run.result
    expect(run.events).toEqual([
      'list',
      'exec:stop:fix-flaky-auth-test',
      'list',
      'exec:reopen:fix-flaky-auth-test',
      'list',
    ])
  })

  it('a routed resume action executes and the loop returns to the list', async () => {
    const run = picker({ keyScript: CR })
    await run.result
    expect(run.events).toEqual(['list', 'exec:resume:fix-flaky-auth-test', 'list'])
  })

  it('routes the hovered row by its state on Enter', async () => {
    const gate = picker({ keyScript: `${DOWN}${CR}` })
    await gate.result
    expect(gate.events).toContain('exec:gate:papai-settings-cleanup')
    const report = picker({ keyScript: `${DOWN}${DOWN}${CR} q` })
    await report.result
    expect(report.events).toContain('report:usage-failure-queries')
  })

  it('report shows inside the shell and consumes one key before the refreshed list', async () => {
    const single: readonly SessionRow[] = [COMPLETED]
    const run = picker({ keyScript: `${CR}${CR}`, rows: (): readonly SessionRow[] => single })
    await run.result
    expect(run.events).toEqual(['list', 'report:usage-failure-queries', 'list'])
  })

  it('an action failure shows a notice that consumes one key, then the list returns', async () => {
    const run = picker({
      keyScript: `${CR}${CR}`,
      executeImpl: (): Promise<void> => Promise.reject(new Error('run cannot be resumed')),
    })
    await run.result
    expect(run.events).toEqual(['list', 'exec:resume:fix-flaky-auth-test', 'list'])
  })

  it('a failed report build is a notice, not an exit', async () => {
    const single: readonly SessionRow[] = [COMPLETED]
    const run = picker({
      keyScript: `${CR}q`,
      rows: (): readonly SessionRow[] => single,
      reportImpl: (): Promise<string> => Promise.reject(new Error('no events log')),
    })
    await run.result
    expect(run.events).toEqual(['list', 'report:usage-failure-queries', 'list'])
  })

  it('creation through the form starts the run and returns to the refreshed list', async () => {
    const run = picker({ keyScript: `nfix flaky auth test${CR}q` })
    await run.result
    expect(run.events).toEqual(['list', 'create:"# fix flaky auth test\\n"', 'list'])
  })

  it('cancelling the form returns to the list with no run started', async () => {
    const run = picker({ keyScript: `n${ESC}q` })
    await run.result
    expect(run.events).toEqual(['list'])
  })

  it('an empty-title submit never leaves the form; the run starts only after a real title', async () => {
    const run = picker({ keyScript: `n${CR}typed title${CR}q` })
    await run.result
    expect(run.events).toEqual(['list', 'create:"# typed title\\n"', 'list'])
  })

  it('a creation failure is a notice, not an exit', async () => {
    const run = picker({
      keyScript: `ntitled${CR} q`,
      createImpl: (): Promise<void> => Promise.reject(new Error('session id taken')),
    })
    await run.result
    expect(run.events).toEqual(['list', 'create:"# titled\\n"', 'list'])
  })

  it('initial create screen starts the form without a list detour', async () => {
    const run = picker({ keyScript: `solo${CR}q`, initial: 'create' })
    await run.result
    expect(run.events).toEqual(['list', 'create:"# solo\\n"', 'list'])
  })

  it('q from the list quits immediately', async () => {
    const run = picker({ keyScript: 'q' })
    await expect(run.result).resolves.toBe('quit')
    expect(run.events).toEqual(['list'])
  })

  it('a confirmed delete removes the run through the removal seam, then the refreshed list returns', async () => {
    const run = picker({ keyScript: `${DOWN}${DOWN}dy q` })
    await run.result
    expect(run.events).toEqual(['list', 'remove:usage-failure-queries', 'list'])
  })

  it('a refused delete (fresh guard) still renders a notice and returns to the refreshed list', async () => {
    const run = picker({
      keyScript: `${DOWN}${DOWN}dy q`,
      removeImpl: (): Promise<RemoveRunResult> =>
        Promise.resolve({ kind: 'refused', runId: 'usage-failure-queries', reason: 'running' }),
    })
    await run.result
    expect(run.events).toEqual(['list', 'remove:usage-failure-queries', 'list'])
  })

  it('d on a running row is a refusal notice — the removal seam is never called', async () => {
    const run = picker({ keyScript: 'd q' })
    await run.result
    expect(run.events).toEqual(['list', 'list'])
  })

  it('cancelling the delete confirmation returns to the list with nothing removed', async () => {
    const run = picker({ keyScript: `${DOWN}${DOWN}d${ESC}q` })
    await run.result
    expect(run.events).toEqual(['list'])
  })

  it('renders an empty list and still allows creation or quit', async () => {
    const empty = picker({ keyScript: 'q', rows: (): readonly SessionRow[] => [] })
    await expect(empty.result).resolves.toBe('quit')
    const created = picker({ keyScript: `nfrom scratch${CR}q`, rows: (): readonly SessionRow[] => [] })
    await created.result
    expect(created.events).toEqual(['list', 'create:"# from scratch\\n"', 'list'])
  })

  it('a long in-mount interaction keeps every buffer — a per-frame remount would reset the form (1.3 pin)', async () => {
    const TAB = '\t'
    const run = picker({ keyScript: `nfix auth${TAB}stops flaky login${CR}q` })
    await run.result
    expect(run.events).toEqual(['list', 'create:"# fix auth\\n\\nstops flaky login\\n"', 'list'])
  })
})
