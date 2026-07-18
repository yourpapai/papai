// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { runPreflight } from '../../../scripts/behavior-audit/preflight.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('preflight', () => {
  afterEach(() => {
    restoreFetch()
    delete process.env['BEHAVIOR_AUDIT_BASE_URL']
    delete process.env['BEHAVIOR_AUDIT_MODEL']
    delete process.env['OPENAI_API_KEY']
  })

  test('exits 0 when gateway offers the configured model', async () => {
    process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'https://gateway.example.com/v1'
    process.env['BEHAVIOR_AUDIT_MODEL'] = 'anthropic/claude-3.5-sonnet'
    process.env['OPENAI_API_KEY'] = 'test-key'
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'anthropic/claude-3.5-sonnet' }, { id: 'openai/gpt-4o' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const result = await runPreflight()
    expect(result).toBe(0)
  })

  test('exits 1 when BEHAVIOR_AUDIT_BASE_URL is missing', async () => {
    process.env['BEHAVIOR_AUDIT_MODEL'] = 'm'
    process.env['OPENAI_API_KEY'] = 'k'
    setMockFetch(() => Promise.resolve(new Response('{}')))
    expect(await runPreflight()).toBe(1)
  })

  test('exits 1 when BEHAVIOR_AUDIT_MODEL is missing', async () => {
    process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'https://x/v1'
    process.env['OPENAI_API_KEY'] = 'k'
    setMockFetch(() => Promise.resolve(new Response('{}')))
    expect(await runPreflight()).toBe(1)
  })

  test('exits 1 when OPENAI_API_KEY is missing', async () => {
    process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'https://x/v1'
    process.env['BEHAVIOR_AUDIT_MODEL'] = 'm'
    setMockFetch(() => Promise.resolve(new Response('{}')))
    expect(await runPreflight()).toBe(1)
  })

  test('exits 1 when fetch throws (network error)', async () => {
    process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'https://x/v1'
    process.env['BEHAVIOR_AUDIT_MODEL'] = 'm'
    process.env['OPENAI_API_KEY'] = 'k'
    setMockFetch(() => Promise.reject(new Error('ECONNREFUSED')))
    expect(await runPreflight()).toBe(1)
  })

  test('exits 1 on HTTP 401', async () => {
    process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'https://x/v1'
    process.env['BEHAVIOR_AUDIT_MODEL'] = 'm'
    process.env['OPENAI_API_KEY'] = 'k'
    setMockFetch(() => Promise.resolve(new Response('unauthorized', { status: 401 })))
    expect(await runPreflight()).toBe(1)
  })

  test('exits 1 when model is not in response', async () => {
    process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'https://x/v1'
    process.env['BEHAVIOR_AUDIT_MODEL'] = 'missing-model'
    process.env['OPENAI_API_KEY'] = 'k'
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'other-model' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    expect(await runPreflight()).toBe(1)
  })

  test('exits 1 on malformed JSON', async () => {
    process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'https://x/v1'
    process.env['BEHAVIOR_AUDIT_MODEL'] = 'm'
    process.env['OPENAI_API_KEY'] = 'k'
    setMockFetch(() => Promise.resolve(new Response('not-json', { status: 200 })))
    expect(await runPreflight()).toBe(1)
  })
})
