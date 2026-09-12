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
