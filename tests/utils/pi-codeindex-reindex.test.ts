import { describe, expect, test } from 'bun:test'

import type { ReindexDeps } from '../../.pi/extensions/codeindex-reindex/index.js'

type Handler = (event: unknown, ctx: unknown) => unknown

type ScheduledTask = {
  readonly token: ReturnType<typeof setTimeout>
  readonly delayMs: number
  readonly run: () => void
}

const loadCodeindexModule = (): Promise<typeof import('../../.pi/extensions/codeindex-reindex/index.js')> =>
  import('../../.pi/extensions/codeindex-reindex/index.js')

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

const createContext = (
  sessionId: string,
): {
  readonly cwd: string
  readonly sessionManager: { readonly getSessionId: () => string }
} => ({
  cwd: '/repo',
  sessionManager: {
    getSessionId: (): string => sessionId,
  },
})

const fakeToRelativePath = (filePath: string, _cwd: string): string => {
  if (filePath.startsWith('/repo/')) return filePath.slice('/repo/'.length)
  return filePath
}

const fakeGetExtension = (filePath: string): string => {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex >= 0) return filePath.slice(dotIndex)
  return ''
}

const fakeDeps = (
  scheduledTasks: ScheduledTask[],
  spawnCalls?: string[],
  cancelledTokens?: unknown[],
): ReindexDeps => ({
  schedule: (delayMs: number, run: () => void): ReturnType<typeof setTimeout> => {
    const task = {
      token: setTimeout(() => {}, 999999),
      delayMs,
      run,
    }
    scheduledTasks.push(task)
    return task.token
  },
  cancel: (token: ReturnType<typeof setTimeout>): void => {
    cancelledTokens?.push(token)
  },
  spawnReindex: (cwd: string): void => {
    spawnCalls?.push(cwd)
  },
  toRelativePath: fakeToRelativePath,
  getExtension: fakeGetExtension,
})

describe('registerCodeindexReindex', () => {
  test('schedules a reindex after qualifying implementation edits', async () => {
    const { registerCodeindexReindex } = await loadCodeindexModule()
    const fakeApi = createFakeApi()
    const scheduledTasks: ScheduledTask[] = []
    const spawnCalls: string[] = []

    registerCodeindexReindex(fakeApi.api, fakeDeps(scheduledTasks, spawnCalls))

    const ctx = createContext('session-a')
    const toolCallHandler = fakeApi.handlers['tool_call']!
    const toolEndHandler = fakeApi.handlers['tool_execution_end']!

    toolCallHandler(
      {
        toolCallId: 'call-a',
        toolName: 'write',
        input: { path: 'src/bot.ts', content: 'export const bot = true\n' },
      },
      ctx,
    )
    toolEndHandler(
      {
        toolCallId: 'call-a',
        toolName: 'write',
        result: null,
        isError: false,
      },
      ctx,
    )

    expect(scheduledTasks.map((task) => task.delayMs)).toEqual([600])

    scheduledTasks[0]?.run()
    expect(spawnCalls).toEqual(['/repo'])
  })

  test('skips scheduling for tests and non-indexed paths', async () => {
    const { registerCodeindexReindex } = await loadCodeindexModule()
    const fakeApi = createFakeApi()
    const scheduledTasks: ScheduledTask[] = []

    registerCodeindexReindex(fakeApi.api, fakeDeps(scheduledTasks))

    const ctx = createContext('session-b')
    const toolCallHandler = fakeApi.handlers['tool_call']!
    const toolEndHandler = fakeApi.handlers['tool_execution_end']!

    toolCallHandler(
      {
        toolCallId: 'call-b1',
        toolName: 'write',
        input: { path: 'tests/example.test.ts', content: 'test()\n' },
      },
      ctx,
    )
    toolEndHandler(
      {
        toolCallId: 'call-b1',
        toolName: 'write',
        result: null,
        isError: false,
      },
      ctx,
    )

    toolCallHandler(
      {
        toolCallId: 'call-b2',
        toolName: 'write',
        input: { path: 'README.md', content: '# README\n' },
      },
      ctx,
    )
    toolEndHandler(
      {
        toolCallId: 'call-b2',
        toolName: 'write',
        result: null,
        isError: false,
      },
      ctx,
    )

    expect(scheduledTasks).toHaveLength(0)
  })

  test('debounces repeated qualifying edits per session', async () => {
    const { registerCodeindexReindex } = await loadCodeindexModule()
    const fakeApi = createFakeApi()
    const scheduledTasks: ScheduledTask[] = []
    const cancelledTokens: unknown[] = []

    registerCodeindexReindex(fakeApi.api, fakeDeps(scheduledTasks, undefined, cancelledTokens))

    const ctx = createContext('session-c')
    const toolCallHandler = fakeApi.handlers['tool_call']!
    const toolEndHandler = fakeApi.handlers['tool_execution_end']!

    toolCallHandler(
      {
        toolCallId: 'call-c1',
        toolName: 'write',
        input: { path: 'src/first.ts', content: 'export const first = 1\n' },
      },
      ctx,
    )
    toolEndHandler(
      {
        toolCallId: 'call-c1',
        toolName: 'write',
        result: null,
        isError: false,
      },
      ctx,
    )

    toolCallHandler(
      {
        toolCallId: 'call-c2',
        toolName: 'edit',
        input: {
          path: '/repo/client/debug/view.tsx',
          edits: [{ oldText: 'before', newText: 'after' }],
        },
      },
      ctx,
    )
    toolEndHandler(
      {
        toolCallId: 'call-c2',
        toolName: 'edit',
        result: null,
        isError: false,
      },
      ctx,
    )

    expect(cancelledTokens).toHaveLength(1)
    expect(cancelledTokens[0]).toBeTypeOf('object')
    expect(scheduledTasks).toHaveLength(2)
    expect(scheduledTasks[1]?.delayMs).toBe(600)
  })
})
