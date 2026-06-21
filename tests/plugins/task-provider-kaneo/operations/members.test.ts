// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { KaneoProvider } from '../../../../plugins/task-provider-kaneo/provider.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const TEST_CONFIG = { apiKey: 'test-key', baseUrl: 'http://kaneo-test' }
const WORKSPACE_ID = 'ws-1'

function makeProvider(): KaneoProvider {
  return new KaneoProvider(TEST_CONFIG, WORKSPACE_ID)
}

describe('KaneoProvider.listUsers', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('is defined on KaneoProvider', () => {
    const provider = makeProvider()
    expect(typeof provider.listUsers).toBe('function')
  })

  test('forwards to kaneoListUsers and returns UserRef[]', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'member' },
            { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'admin' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    const provider = makeProvider()
    const result = await provider.listUsers()
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'u1', login: 'alice@example.com', name: 'Alice' })
    restoreFetch()
  })

  test('respects capabilities: members.provision is set', () => {
    const provider = makeProvider()
    expect(provider.capabilities.has('members.provision')).toBe(true)
  })
})
