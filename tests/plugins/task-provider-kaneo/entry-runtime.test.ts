// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { createKaneoProvider } from '../../../plugins/task-provider-kaneo/entry-runtime.js'
import { KaneoProvider } from '../../../plugins/task-provider-kaneo/provider.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('createKaneoProvider transport', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('routes requests through the injected fetch transport (api-key path)', async () => {
    const httpFetch = mock<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
    )

    const provider = createKaneoProvider(
      { baseUrl: 'https://kaneo.invalid', credential: 'key', workspaceId: 'workspace-1' },
      httpFetch,
    )
    assert(provider instanceof KaneoProvider)

    await provider.listProjects()

    expect(httpFetch).toHaveBeenCalledWith(
      'https://kaneo.invalid/api/project?workspaceId=workspace-1',
      expect.any(Object),
    )
    expect(httpFetch).toHaveBeenCalledTimes(1)
  })

  test('routes requests through the injected fetch transport (session-cookie path)', async () => {
    const httpFetch = mock<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
    )

    const provider = createKaneoProvider(
      {
        baseUrl: 'https://kaneo.invalid',
        credential: 'better-auth.session_token=abc',
        workspaceId: 'workspace-1',
      },
      httpFetch,
    )
    assert(provider instanceof KaneoProvider)

    await provider.listProjects()

    expect(httpFetch).toHaveBeenCalledWith(
      'https://kaneo.invalid/api/project?workspaceId=workspace-1',
      expect.any(Object),
    )
    expect(httpFetch).toHaveBeenCalledTimes(1)
  })
})

/** The provider keeps its built config private; member auth routing needs it observable. */
const readBuiltConfig = (provider: object): unknown => Reflect.get(provider, 'config')

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

describe('createKaneoProvider internalUrl', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('preserves the instance internalUrl in the built provider config', () => {
    const provider = createKaneoProvider({
      baseUrl: 'https://kaneo.public.invalid',
      internalUrl: 'http://kaneo.internal.invalid',
      credential: 'key',
      workspaceId: 'workspace-1',
    })
    const config = readBuiltConfig(provider)
    assert(isRecord(config))

    expect(config['internalUrl']).toBe('http://kaneo.internal.invalid')
    expect(config['baseUrl']).toBe('https://kaneo.public.invalid')
  })

  test('leaves internalUrl undefined when the instance omits it', () => {
    const provider = createKaneoProvider({
      baseUrl: 'https://kaneo.public.invalid',
      credential: 'key',
      workspaceId: 'workspace-1',
    })
    const config = readBuiltConfig(provider)
    assert(isRecord(config))

    expect(config['internalUrl']).toBeUndefined()
  })
})
