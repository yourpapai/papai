// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  deleteByokProviderAction,
  refreshByokModels,
  setByokRolesAction,
  upsertByokProviderAction,
} from '../../../client/settings/byok-provider-fetchers.js'
import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

type CapturedFetchCall = Readonly<{ url: string; init: RequestInit }>

const captured: CapturedFetchCall[] = []

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const installFetch = (payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(json(payload))
  })
}

const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

describe('BYOK multi-provider action fetchers', () => {
  test('upsertByokProviderAction PATCHes an upsert-provider action', async () => {
    installFetch({ ok: true })
    await upsertByokProviderAction({
      contextId: 'ctx-1',
      provider: {
        id: 'prov_1',
        label: 'Test',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-xxx',
        verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
      },
    })
    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(captured[0]?.url).toBe('/settings/api/byok')
    expect(parseBody(captured[0]?.init.body)).toEqual(
      expect.objectContaining({ action: 'upsert-provider', contextId: 'ctx-1' }),
    )
  })

  test('deleteByokProviderAction PATCHes a delete-provider action', async () => {
    installFetch({ ok: true })
    await deleteByokProviderAction({ contextId: 'ctx-1', id: 'prov_1' })
    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(parseBody(captured[0]?.init.body)).toEqual(
      expect.objectContaining({ action: 'delete-provider', id: 'prov_1' }),
    )
  })

  test('setByokRolesAction PATCHes a set-roles action', async () => {
    installFetch({ ok: true })
    await setByokRolesAction({
      contextId: 'ctx-1',
      roles: { main: { providerId: 'prov_1', model: 'gpt-4o' }, small: null, embedding: null },
    })
    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(parseBody(captured[0]?.init.body)).toEqual(expect.objectContaining({ action: 'set-roles' }))
  })

  test('refreshByokModels PATCHes a refresh-models action', async () => {
    installFetch({ ok: true })
    await refreshByokModels({ contextId: 'ctx-1', id: 'prov_1' })
    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(parseBody(captured[0]?.init.body)).toEqual(
      expect.objectContaining({ action: 'refresh-models', id: 'prov_1' }),
    )
  })
})
