// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getResponse } from 'msw'
import type { HttpHandler } from 'msw'

import { codingCredentialsHandlers, forgeHandlers } from '../../../../client/stories/msw/settings-handlers-coding.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('coding settings msw handlers', () => {
  test('codingCredentialsHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(codingCredentialsHandlers.populated)).toBe(true)
    expect(Array.isArray(codingCredentialsHandlers.empty)).toBe(true)
    expect(Array.isArray(codingCredentialsHandlers.error)).toBe(true)
    expect(Array.isArray(codingCredentialsHandlers.loading)).toBe(true)
    expect(codingCredentialsHandlers.populated.length).toBeGreaterThan(0)
  })

  test('codingCredentialsHandlers populated covers /settings/api/coding-credentials', () => {
    expect(
      pathsOf(codingCredentialsHandlers.populated).some((p) => p.includes('/settings/api/coding-credentials')),
    ).toBe(true)
  })

  test('codingCredentialsHandlers populated wires the models endpoint', () => {
    expect(
      pathsOf(codingCredentialsHandlers.populated).some((p) => p.includes('/settings/api/coding-credentials/models')),
    ).toBe(true)
  })

  test('forgeHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(forgeHandlers.populated)).toBe(true)
    expect(Array.isArray(forgeHandlers.empty)).toBe(true)
    expect(Array.isArray(forgeHandlers.error)).toBe(true)
    expect(Array.isArray(forgeHandlers.loading)).toBe(true)
    expect(forgeHandlers.populated.length).toBeGreaterThan(0)
  })

  test('forgeHandlers populated covers /settings/api/coding-credentials', () => {
    expect(pathsOf(forgeHandlers.populated).some((p) => p.includes('/settings/api/coding-credentials'))).toBe(true)
  })

  test('forgeHandlers populated response carries exactly the forge fields, no cross-namespace leakage', async () => {
    const response = await getResponse(
      forgeHandlers.populated,
      new Request('http://localhost/settings/api/coding-credentials?contextId=ctx-personal-1&namespace=forge'),
    )
    expect(response).toBeDefined()
    const body: unknown = await response?.json()
    // Full deep equality (not objectContaining) so an over-broad body -- e.g. a stray
    // allowedAgents or catalog key leaking from the neighboring namespaces -- fails here.
    expect(body).toEqual({
      namespace: 'forge',
      configured: true,
      complete: true,
      missing: [],
      fields: [
        {
          key: 'kind',
          label: 'Host type',
          required: true,
          sensitive: false,
          hasValue: true,
          value: 'github',
          control: 'select',
          options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
        },
        {
          key: 'instance_url',
          label: 'Instance URL',
          required: false,
          sensitive: false,
          hasValue: false,
          value: '',
        },
        {
          key: 'forge_token',
          label: 'Access token',
          required: true,
          sensitive: true,
          hasValue: true,
          value: '****cd34',
        },
      ],
    })
  })

  test('forgeHandlers empty response reports both required fields as missing', async () => {
    const response = await getResponse(
      forgeHandlers.empty,
      new Request('http://localhost/settings/api/coding-credentials?contextId=ctx-personal-1&namespace=forge'),
    )
    expect(response).toBeDefined()
    const body: unknown = await response?.json()
    // Same full deep equality as the populated case. `missing` is the load-bearing part:
    // CodeHostSection derives its "not connected" header state from it, and the list must
    // track allRequiredFields (src/coding-credentials/store.ts) -- kind and forge_token,
    // never instance_url, which is only conditionally required.
    expect(body).toEqual({
      namespace: 'forge',
      configured: false,
      complete: false,
      missing: ['kind', 'forge_token'],
      fields: [
        {
          key: 'kind',
          label: 'Host type',
          required: true,
          sensitive: false,
          hasValue: false,
          value: '',
          control: 'select',
          options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
        },
        {
          key: 'instance_url',
          label: 'Instance URL',
          required: false,
          sensitive: false,
          hasValue: false,
          value: '',
        },
        {
          key: 'forge_token',
          label: 'Access token',
          required: true,
          sensitive: true,
          hasValue: false,
          value: '',
        },
      ],
    })
  })
})
