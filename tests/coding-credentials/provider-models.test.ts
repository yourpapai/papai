// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'

import { fetchProviderModels } from '../../src/coding-credentials/provider-models.js'
import { restoreFetch, setMockFetch } from '../utils/test-helpers.js'

afterEach(() => restoreFetch())

describe('fetchProviderModels', () => {
  it('lists OpenAI models', async () => {
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'o3' }] }), { status: 200 })),
    )
    expect(await fetchProviderModels('openai', undefined, 'k', 'codex')).toEqual([
      { value: 'gpt-5', label: 'gpt-5' },
      { value: 'o3', label: 'o3' },
    ])
  })

  it('lists Anthropic models', async () => {
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }] }), { status: 200 })),
    )
    expect(await fetchProviderModels('anthropic', undefined, 'k', 'claude')).toEqual([
      { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    ])
  })

  it('prefixes ids for opencode (openai provider)', async () => {
    setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 })))
    expect(await fetchProviderModels('openai', undefined, 'k', 'opencode')).toEqual([
      { value: 'openai/gpt-5', label: 'openai/gpt-5' },
    ])
  })

  it('throws on a non-200', async () => {
    setMockFetch(() => Promise.resolve(new Response('nope', { status: 500 })))
    await expect(fetchProviderModels('openai', undefined, 'k', 'codex')).rejects.toThrow()
  })

  it('rejects a private base URL (SSRF)', async () => {
    await expect(fetchProviderModels('openai-compatible', 'http://127.0.0.1/v1', 'k', 'codex')).rejects.toThrow()
  })

  it('rejects a redirect (no following to a private address)', async () => {
    setMockFetch(() =>
      Promise.resolve(new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/' } })),
    )
    // redirect:'error' causes the runtime to reject; with the mock the 301 fails res.ok → throws
    await expect(fetchProviderModels('openai', undefined, 'k', 'codex')).rejects.toThrow()
  })

  it('strips trailing /v1 from an anthropic gateway base URL (avoids /v1/v1/models)', async () => {
    let capturedUrl = ''
    setMockFetch((url) => {
      capturedUrl = url
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }] }), { status: 200 }))
    })
    // api.anthropic.com/v1 is a common gateway convention; the code must strip /v1
    // so the final URL is /v1/models, not /v1/v1/models.
    await fetchProviderModels('anthropic', 'https://api.anthropic.com/v1', 'k', 'claude')
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/models')
    expect(capturedUrl).not.toContain('/v1/v1/')
  })

  it('prefixes ids for opencode (anthropic provider)', async () => {
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'claude-opus-4' }] }), { status: 200 })),
    )
    expect(await fetchProviderModels('anthropic', undefined, 'k', 'opencode')).toEqual([
      { value: 'anthropic/claude-opus-4', label: 'anthropic/claude-opus-4' },
    ])
  })
})
