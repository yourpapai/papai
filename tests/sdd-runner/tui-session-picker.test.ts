// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { SessionRow } from '../../sdd-runner/src/session-list.js'
import { runSessionPicker } from '../../sdd-runner/src/tui-session-picker.js'

const CR = '\r'

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

const ROWS: readonly SessionRow[] = [
  row(),
  row({
    runId: 'papai-settings-cleanup',
    changeName: 'papai-settings-cleanup',
    pendingDecision: { kind: 'gate', mode: 'early', version: 2 },
  }),
  row({ runId: 'usage-failure-queries', changeName: 'usage-failure-queries', status: 'completed' }),
]

describe('runSessionPicker (scripted keys)', () => {
  function pick(keyScript: string): Promise<unknown> {
    return runSessionPicker({ listRows: () => Promise.resolve(ROWS), keyScript })
  }

  it('routes the hovered row by its state on Enter', async () => {
    await expect(pick(CR)).resolves.toEqual({ kind: 'resume', runId: 'fix-flaky-auth-test' })
    await expect(pick(`\u001b[B${CR}`)).resolves.toEqual({ kind: 'gate', runId: 'papai-settings-cleanup' })
    await expect(pick(`\u001b[B\u001b[B${CR}`)).resolves.toEqual({
      kind: 'report',
      runId: 'usage-failure-queries',
    })
  })

  it('requests a calm stop for the hovered active row', async () => {
    await expect(pick('s')).resolves.toEqual({ kind: 'stop', runId: 'fix-flaky-auth-test' })
  })

  it('reopens the hovered settled row', async () => {
    await expect(pick('\u001b[B\u001b[Br')).resolves.toEqual({ kind: 'reopen', runId: 'usage-failure-queries' })
  })

  it('opens creation with n', async () => {
    await expect(pick('n')).resolves.toEqual({ kind: 'create' })
  })

  it('abandons on q and on an exhausted script, writing nothing', async () => {
    await expect(pick('q')).resolves.toBe(null)
    await expect(pick('')).resolves.toBe(null)
  })

  it('renders rows even when none exist, still allowing creation or quit', async () => {
    await expect(runSessionPicker({ listRows: () => Promise.resolve([]), keyScript: 'n' })).resolves.toEqual({
      kind: 'create',
    })
    await expect(runSessionPicker({ listRows: () => Promise.resolve([]), keyScript: '' })).resolves.toBe(null)
  })
})
