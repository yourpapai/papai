// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createAdminProvider,
  deleteAdminProvider,
  fetchAdminLlmRoles,
  fetchAdminProviders,
  putAdminLlmRoles,
  updateAdminProvider,
} from '../../../client/settings/admin-fetchers.js'
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

const sampleProvider = {
  id: 'prov_1',
  label: 'OpenAI',
  providerType: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1',
  apiKeyMasked: '****abcd',
  verification: { status: 'unverified' as const, error: null, at: null, models: [], modelsFetchedAt: null },
}

describe('admin LLM provider fetchers', () => {
  test('fetchAdminProviders GETs the providers list', async () => {
    installFetch({ providers: [] })
    await fetchAdminProviders()
    expect(captured[0]?.url).toBe('/settings/api/admin/providers')
    expect(methodOf(captured[0]!.init)).toBe('GET')
  })

  test('createAdminProvider POSTs a provider body', async () => {
    installFetch({ provider: sampleProvider })
    await createAdminProvider({
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-xxx',
    })
    expect(methodOf(captured[0]!.init)).toBe('POST')
    expect(parseBody(captured[0]?.init.body)).toEqual({
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-xxx',
    })
  })

  test('updateAdminProvider PATCHes a provider', async () => {
    installFetch({ provider: sampleProvider })
    await updateAdminProvider('prov_1', { label: 'Renamed' })
    expect(captured[0]?.url).toBe('/settings/api/admin/providers/prov_1')
    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(parseBody(captured[0]?.init.body)).toEqual({ label: 'Renamed' })
  })

  test('deleteAdminProvider DELETEs a provider', async () => {
    installFetch({ ok: true })
    await deleteAdminProvider('prov_1')
    expect(captured[0]?.url).toBe('/settings/api/admin/providers/prov_1')
    expect(methodOf(captured[0]!.init)).toBe('DELETE')
  })

  test('fetchAdminLlmRoles GETs the roles', async () => {
    installFetch({ roles: { main: { providerId: '', model: '' }, small: null, embedding: null } })
    await fetchAdminLlmRoles()
    expect(captured[0]?.url).toBe('/settings/api/admin/llm-roles')
    expect(methodOf(captured[0]!.init)).toBe('GET')
  })

  test('putAdminLlmRoles PUTs the roles body', async () => {
    installFetch({ ok: true })
    await putAdminLlmRoles({
      main: { providerId: 'prov_1', model: 'gpt-4o' },
      small: null,
      embedding: null,
    })
    expect(methodOf(captured[0]!.init)).toBe('PUT')
    expect(parseBody(captured[0]?.init.body)).toEqual({
      main: { providerId: 'prov_1', model: 'gpt-4o' },
      small: null,
      embedding: null,
    })
  })
})
