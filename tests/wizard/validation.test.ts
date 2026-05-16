// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { validateLlmApiKey, validateLlmBaseUrl, validateModelExists } from '../../src/wizard/validation.js'
import { restoreFetch, setMockFetch } from '../utils/test-helpers.js'

describe('validateLlmApiKey', () => {
  beforeEach(() => {
    restoreFetch()
  })

  test('should return success for valid API key', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4' }] }), {
          status: 200,
          statusText: 'OK',
        }),
      ),
    )
    const result = await validateLlmApiKey('sk-test', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })
})

describe('validateLlmApiKey with mocked fetch', () => {
  beforeEach(() => {
    restoreFetch()
  })

  test('should succeed when API returns 200', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4' }] }), {
          status: 200,
          statusText: 'OK',
        }),
      ),
    )

    const result = await validateLlmApiKey('sk-valid', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })

  test('should fail when API returns 401', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response('', {
          status: 401,
          statusText: 'Unauthorized',
        }),
      ),
    )

    const result = await validateLlmApiKey('sk-invalid', 'https://api.openai.com/v1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('Invalid API key')
  })
})

describe('validateLlmBaseUrl', () => {
  beforeEach(() => {
    restoreFetch()
  })

  test('should succeed when URL is reachable', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response('', {
          status: 200,
          statusText: 'OK',
        }),
      ),
    )

    const result = await validateLlmBaseUrl('https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })

  test('should fail when URL is unreachable', async () => {
    setMockFetch(() => Promise.reject(new Error('Connection refused')))

    const result = await validateLlmBaseUrl('http://localhost:99999')
    expect(result.success).toBe(false)
    expect(result.message).toContain('Cannot connect')
  })
})

describe('validateModelExists', () => {
  beforeEach(() => {
    restoreFetch()
  })

  test('should succeed when model exists', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }] }), {
          status: 200,
          statusText: 'OK',
        }),
      ),
    )

    const result = await validateModelExists('gpt-4', 'sk-test', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })

  test('should fail when model does not exist', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4' }] }), {
          status: 200,
          statusText: 'OK',
        }),
      ),
    )

    const result = await validateModelExists('nonexistent-model', 'sk-test', 'https://api.openai.com/v1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
  })
})
