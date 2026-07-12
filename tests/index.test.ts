// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { runProduction, type ProductionShellDeps } from '../src/index.js'
import { createProductionRuntimeDeps } from '../src/runtime/production-deps.js'
import type { PapaiRuntime } from '../src/runtime/types.js'

const originalAdminUserId = process.env['ADMIN_USER_ID']

afterEach(() => {
  if (originalAdminUserId === undefined) delete process.env['ADMIN_USER_ID']
  else process.env['ADMIN_USER_ID'] = originalAdminUserId
})

function createRuntimeStub(
  start: () => Promise<void>,
  stop: () => Promise<void> = (): Promise<void> => Promise.resolve(),
): PapaiRuntime {
  return {
    start,
    stop,
    dispatch: (): Promise<void> => Promise.resolve(),
    dispatchInteraction: (): Promise<void> => Promise.resolve(),
    request: (): Promise<Response> => Promise.resolve(new Response()),
    resolveToolCapability: (): string => 'wire-name',
  }
}

function createShellDeps(events: string[]): ProductionShellDeps {
  const runtime = createRuntimeStub(
    (): Promise<void> => {
      events.push('runtime:start')
      return Promise.resolve()
    },
    (): Promise<void> => {
      events.push('runtime:stop')
      return Promise.resolve()
    },
  )
  return {
    createDeps: () => {
      events.push('deps:create')
      return createProductionRuntimeDeps()
    },
    createRuntime: (config) => {
      events.push(
        `runtime:create:${String(config.startBackgroundServices)}:${String(config.startNetworkServer)}:${String(config.sendStartupAnnouncement)}`,
      )
      return runtime
    },
    exit: (code) => {
      events.push(`exit:${String(code)}`)
    },
    onSignal: (signal, handler) => {
      events.push(`signal:${signal}`)
      if (signal === 'SIGTERM') void handler()
    },
  }
}

describe('production shell', () => {
  test('creates and starts one fully enabled production runtime', async () => {
    process.env['ADMIN_USER_ID'] = 'admin-1'
    const events: string[] = []

    await runProduction(createShellDeps(events))
    await Promise.resolve()

    expect(events).toEqual([
      'deps:create',
      'runtime:create:true:true:true',
      'runtime:start',
      'signal:SIGTERM',
      'runtime:stop',
      'signal:SIGINT',
      'exit:0',
    ])
  })

  test('exits before composition when ADMIN_USER_ID is missing', async () => {
    delete process.env['ADMIN_USER_ID']
    const events: string[] = []

    await runProduction(createShellDeps(events))

    expect(events).toEqual(['exit:1'])
  })

  test('logs and exits when startup fails', async () => {
    process.env['ADMIN_USER_ID'] = 'admin-1'
    const events: string[] = []
    const deps = createShellDeps(events)
    const error = mock(() => undefined)
    deps.createRuntime = (): PapaiRuntime => createRuntimeStub(() => Promise.reject(new Error('startup boom')))

    await runProduction(deps, { error })

    expect(error).toHaveBeenCalledWith({ error: 'startup boom' }, 'Papai startup failed')
    expect(events.at(-1)).toBe('exit:1')
  })
})
