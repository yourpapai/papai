// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

type Handler = (event: unknown, ctx: unknown) => unknown

type SessionStateRecord = {
  needsRecheck: boolean
}

const loadRegisterTddEnforcement = (): Promise<
  typeof import('../../.pi/extensions/tdd-enforcement/index.js').registerTddEnforcement
> => {
  return import('../../.pi/extensions/tdd-enforcement/index.js').then((module) => module.registerTddEnforcement)
}

const createFakeApi = (): {
  readonly api: {
    readonly on: (eventName: string, handler: Handler) => void
  }
  readonly handlers: Record<string, Handler>
} => {
  const handlers: Record<string, Handler> = {}
  return {
    api: {
      on: (eventName, handler) => {
        handlers[eventName] = handler
      },
    },
    handlers,
  }
}

const createSessionStateStore = (
  initial: Readonly<Record<string, SessionStateRecord>> = {},
): {
  readonly createSessionState: (sessionId: string) => {
    readonly getNeedsRecheck: () => boolean
    readonly setNeedsRecheck: (value: boolean) => void
  }
  readonly getRecord: (sessionId: string) => SessionStateRecord
} => {
  const records = new Map(Object.entries(initial).map(([sessionId, record]) => [sessionId, { ...record }]))

  const getRecord = (sessionId: string): SessionStateRecord => {
    const existing = records.get(sessionId)
    if (existing !== undefined) return existing

    const created = { needsRecheck: true }
    records.set(sessionId, created)
    return created
  }

  return {
    createSessionState: (sessionId: string) => ({
      getNeedsRecheck: (): boolean => getRecord(sessionId).needsRecheck,
      setNeedsRecheck: (value: boolean): void => {
        getRecord(sessionId).needsRecheck = value
      },
    }),
    getRecord,
  }
}

const createContext = (
  sessionId: string,
): {
  readonly cwd: string
  readonly sessionManager: { readonly getSessionId: () => string }
  readonly ui: {
    readonly notifyCalls: Array<{ readonly message: string; readonly level: string | undefined }>
    readonly notify: (message: string, level?: string) => void
  }
} => {
  const notifyCalls: Array<{ readonly message: string; readonly level: string | undefined }> = []

  return {
    cwd: '/repo',
    sessionManager: {
      getSessionId: (): string => sessionId,
    },
    ui: {
      notifyCalls,
      notify: (message: string, level?: string): void => {
        notifyCalls.push({ message, level })
      },
    },
  }
}

describe('registerTddEnforcement', () => {
  test('blocks destructive git stash commands during tool_call', async () => {
    const registerTddEnforcement = await loadRegisterTddEnforcement()
    const fakeApi = createFakeApi()
    const sessionStateStore = createSessionStateStore()

    registerTddEnforcement(fakeApi.api, {
      blockGitStash: () => ({ decision: 'block', reason: 'git stash is not allowed.' }),
      blockGitCheckoutDiscard: () => null,
      enforceWritePolicy: () => null,
      enforceTdd: () => null,
      trackTestWrite: () => null,
      verifyTestImport: () => null,
      checkFull: () => null,
      createSessionState: sessionStateStore.createSessionState,
    })

    const handler = fakeApi.handlers['tool_call']!
    const result = handler(
      {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'git stash' },
      },
      createContext('session-1'),
    )

    expect(result).toEqual({ block: true, reason: 'git stash is not allowed.' })
  })

  test('passes write events through repo hooks and marks the session for recheck', async () => {
    const registerTddEnforcement = await loadRegisterTddEnforcement()
    const fakeApi = createFakeApi()
    const sessionStateStore = createSessionStateStore({
      'session-2': { needsRecheck: false },
    })
    const writePolicyCalls: Array<Record<string, unknown>> = []
    const tddCalls: Array<Record<string, unknown>> = []

    registerTddEnforcement(fakeApi.api, {
      blockGitStash: () => null,
      blockGitCheckoutDiscard: () => null,
      enforceWritePolicy: (ctx) => {
        writePolicyCalls.push(ctx)
        return null
      },
      enforceTdd: (ctx) => {
        tddCalls.push(ctx)
        return null
      },
      trackTestWrite: () => null,
      verifyTestImport: () => null,
      checkFull: () => null,
      createSessionState: sessionStateStore.createSessionState,
    })

    const handler = fakeApi.handlers['tool_call']!
    const result = handler(
      {
        toolCallId: 'call-2',
        toolName: 'write',
        input: { path: 'src/example.ts', content: 'export const value = 1\n' },
      },
      createContext('session-2'),
    )

    expect(result).toBeUndefined()
    expect(writePolicyCalls).toEqual([
      {
        tool_name: 'write',
        tool_input: {
          path: 'src/example.ts',
          content: 'export const value = 1\n',
          file_path: 'src/example.ts',
        },
        session_id: 'session-2',
        cwd: '/repo',
      },
    ])
    expect(tddCalls).toEqual(writePolicyCalls)
    expect(sessionStateStore.getRecord('session-2').needsRecheck).toBe(true)
  })

  test('tracks completed writes and surfaces verify-test-import failures at tool_execution_end', async () => {
    const registerTddEnforcement = await loadRegisterTddEnforcement()
    const fakeApi = createFakeApi()
    const sessionStateStore = createSessionStateStore()
    const trackCalls: Array<Record<string, unknown>> = []

    registerTddEnforcement(fakeApi.api, {
      blockGitStash: () => null,
      blockGitCheckoutDiscard: () => null,
      enforceWritePolicy: () => null,
      enforceTdd: () => null,
      trackTestWrite: (ctx) => {
        trackCalls.push(ctx)
        return null
      },
      verifyTestImport: () => ({ decision: 'block', reason: 'missing import' }),
      checkFull: () => null,
      createSessionState: sessionStateStore.createSessionState,
    })

    const ctx = createContext('session-3')
    const toolCallHandler = fakeApi.handlers['tool_call']!
    const toolEndHandler = fakeApi.handlers['tool_execution_end']!

    toolCallHandler(
      {
        toolCallId: 'call-3',
        toolName: 'write',
        input: { path: 'tests/example.test.ts', content: 'import value from "./example.js"\n' },
      },
      ctx,
    )

    toolEndHandler(
      {
        toolCallId: 'call-3',
        toolName: 'write',
        result: null,
        isError: false,
      },
      ctx,
    )

    expect(trackCalls).toEqual([
      {
        tool_input: { file_path: 'tests/example.test.ts' },
        session_id: 'session-3',
        cwd: '/repo',
      },
    ])
    expect(ctx.ui.notifyCalls).toEqual([{ message: 'missing import', level: 'error' }])
  })

  test('runs the full check on agent_end and keeps the failure pending for the next turn', async () => {
    const registerTddEnforcement = await loadRegisterTddEnforcement()
    const fakeApi = createFakeApi()
    const sessionStateStore = createSessionStateStore({
      'session-4': { needsRecheck: true },
    })
    const checkCalls: Array<Record<string, unknown>> = []

    registerTddEnforcement(fakeApi.api, {
      blockGitStash: () => null,
      blockGitCheckoutDiscard: () => null,
      enforceWritePolicy: () => null,
      enforceTdd: () => null,
      trackTestWrite: () => null,
      verifyTestImport: () => null,
      checkFull: (ctx) => {
        checkCalls.push(ctx)
        return { decision: 'block', reason: 'bun check:full failed' }
      },
      createSessionState: sessionStateStore.createSessionState,
    })

    const ctx = createContext('session-4')
    const handler = fakeApi.handlers['agent_end']!

    handler({ messages: [] }, ctx)

    expect(checkCalls).toEqual([{ cwd: '/repo', session_id: 'session-4' }])
    expect(ctx.ui.notifyCalls).toEqual([{ message: 'bun check:full failed', level: 'error' }])
    expect(sessionStateStore.getRecord('session-4').needsRecheck).toBe(false)
  })
})
