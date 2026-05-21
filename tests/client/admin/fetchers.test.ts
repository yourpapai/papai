// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchAdminLlm, fetchAdminSystem, submitAdminLlm } from '../../../client/admin/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const captured: Array<{ readonly url: string; readonly init: RequestInit }> = []

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  restoreFetch()
})

const installFetch = (status: number, payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }),
    )
  })
}

describe('fetchAdminLlm', () => {
  test('GETs /admin/llm', async () => {
    const empty = { value: null, updatedAt: null, updatedBy: null }
    installFetch(200, {
      llm_apikey: empty,
      llm_baseurl: empty,
      main_model: empty,
      small_model: empty,
      embedding_model: empty,
    })
    const snap = await fetchAdminLlm()
    expect(captured[0]?.url).toBe('/admin/llm')
    expect(snap.llm_apikey.value).toBeNull()
  })
})

describe('submitAdminLlm', () => {
  test('POSTs JSON body to /admin/llm', async () => {
    installFetch(200, { ok: true, key: 'main_model', updatedAt: 123 })
    const result = await submitAdminLlm({ key: 'main_model', value: 'gpt-6' })
    expect(captured[0]?.url).toBe('/admin/llm')
    expect(captured[0]?.init.method).toBe('POST')
    expect(captured[0]?.init.body).toBe(JSON.stringify({ key: 'main_model', value: 'gpt-6' }))
    expect(result.key).toBe('main_model')
  })

  test('throws on 400 with the server message', async () => {
    installFetch(400, { error: 'value must be a non-empty string' })
    await expect(submitAdminLlm({ key: 'main_model', value: '' })).rejects.toThrow('value must be a non-empty string')
  })
})

describe('fetchAdminSystem', () => {
  test('GETs /admin/system and validates the summary', async () => {
    installFetch(200, { chatProvider: 'telegram', taskProvider: 'kaneo', debugServer: true, adminUserSet: true })
    const result = await fetchAdminSystem()
    expect(captured[0]?.url).toBe('/admin/system')
    expect(result.chatProvider).toBe('telegram')
  })
})
