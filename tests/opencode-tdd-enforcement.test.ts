// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

const checkFullCalls: Array<{ ctx: { cwd: string; session_id: string }; skipTests: boolean | undefined }> = []
const sessionStateById = new Map<string, { needsRecheck: boolean }>()

const getSessionState = (sessionId: string): { needsRecheck: boolean } => {
  const existing = sessionStateById.get(sessionId)
  if (existing !== undefined) return existing

  const created = { needsRecheck: true }
  sessionStateById.set(sessionId, created)
  return created
}

const isFunction = (value: unknown): value is (...args: Array<unknown>) => unknown => {
  return typeof value === 'function'
}

const expectFunction = (value: unknown, name: string): ((...args: Array<unknown>) => unknown) => {
  if (!isFunction(value)) {
    throw new Error(`Expected ${name} function`)
  }

  return value
}

const expectRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    throw new Error(`Expected ${name} object`)
  }

  const record: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry
  }

  return record
}

class FakeSessionState {
  readonly #sessionId: string

  constructor(sessionId: string) {
    this.#sessionId = sessionId
  }

  getNeedsRecheck(): boolean {
    return getSessionState(this.#sessionId).needsRecheck
  }

  setNeedsRecheck(value: boolean): void {
    getSessionState(this.#sessionId).needsRecheck = value
  }
}

void mock.module('../.hooks/tdd/checks/check-full.mjs', () => ({
  checkFull: (ctx: { cwd: string; session_id: string }, skipTests: boolean | undefined): null => {
    checkFullCalls.push({ ctx, skipTests })
    return null
  },
}))

void mock.module('../.hooks/tdd/session-state.mjs', () => ({
  SessionState: FakeSessionState,
}))

void mock.module('../.hooks/tdd/paths.mjs', () => ({
  getSessionsDir: (): string => '/unused',
}))

void mock.module('../.hooks/git/checks/block-git-stash.mjs', () => ({
  blockGitStash: (): null => null,
}))

void mock.module('../.hooks/git/checks/block-git-checkout-discard.mjs', () => ({
  blockGitCheckoutDiscard: (): null => null,
}))

void mock.module('../.hooks/tdd/checks/enforce-tdd.mjs', () => ({
  enforceTdd: (): null => null,
}))

void mock.module('../.hooks/tdd/checks/enforce-write-policy.mjs', () => ({
  enforceWritePolicy: (): null => null,
}))

void mock.module('../.hooks/tdd/checks/track-test-write.mjs', () => ({
  trackTestWrite: (): null => null,
}))

void mock.module('../.hooks/tdd/checks/verify-test-import.mjs', () => ({
  verifyTestImport: (): null => null,
}))

describe('TddEnforcement', () => {
  test('runs check:full without tests during session.idle rechecks', async () => {
    checkFullCalls.length = 0
    sessionStateById.clear()

    const pluginModule = await import('../.opencode/plugins/tdd-enforcement.ts')
    const pluginFactory = expectFunction(Reflect.get(pluginModule, 'TddEnforcement'), 'TddEnforcement')
    const plugin = expectRecord(
      await pluginFactory({
        client: {
          session: {
            promptAsync: mock((): Promise<void> => Promise.resolve()),
          },
        },
        directory: '/repo',
      }),
      'plugin hooks',
    )

    const beforeHook = expectFunction(Reflect.get(plugin, 'tool.execute.before'), 'tool.execute.before')

    await beforeHook(
      {
        tool: 'bash',
        sessionID: 'session-1',
        callID: 'call-1',
      },
      {
        args: { command: 'pwd' },
      },
    )

    const eventHook = expectFunction(Reflect.get(plugin, 'event'), 'event')

    await eventHook({ event: { type: 'session.idle' } })

    expect(checkFullCalls).toEqual([
      {
        ctx: { cwd: '/repo', session_id: 'session-1' },
        skipTests: true,
      },
    ])
  })
})
