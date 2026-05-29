// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { buildPermissionDenied, extendSchemaForAsk } from '../../src/tools/permission-gate.js'

describe('buildPermissionDenied', () => {
  test('returns structured permission_denied shape', () => {
    const result = buildPermissionDenied('User denied the call.')
    expect(result).toEqual({ status: 'permission_denied', message: 'User denied the call.' })
  })
})

describe('extendSchemaForAsk', () => {
  test('adds required _permission_reason field', () => {
    const original = z.object({ id: z.string() })
    const extended = extendSchemaForAsk(original)
    expect(extended.safeParse({ id: 'x' }).success).toBe(false)
    expect(extended.safeParse({ id: 'x', _permission_reason: 'because' }).success).toBe(true)
  })

  test('rejects empty reason', () => {
    const extended = extendSchemaForAsk(z.object({ id: z.string() }))
    expect(extended.safeParse({ id: 'x', _permission_reason: '' }).success).toBe(false)
  })

  test('rejects reason over 280 chars', () => {
    const extended = extendSchemaForAsk(z.object({ id: z.string() }))
    const tooLong = 'x'.repeat(281)
    expect(extended.safeParse({ id: 'x', _permission_reason: tooLong }).success).toBe(false)
  })

  test('preserves original fields', () => {
    const original = z.object({ id: z.string(), count: z.number() })
    const extended = extendSchemaForAsk(original)
    expect(extended.safeParse({ id: 'x', _permission_reason: 'r' }).success).toBe(false)
    expect(extended.safeParse({ id: 'x', count: 1, _permission_reason: 'r' }).success).toBe(true)
  })
})

import { type AskPermissionFn, gatedExecute } from '../../src/tools/permission-gate.js'

const toolOpts = { toolCallId: 't1' }

function fakeExecute(input: unknown, _opts: unknown): Promise<string> {
  const rec = typeof input === 'object' && input !== null ? input : {}
  return Promise.resolve(`ran:${String(Object.entries(rec).find(([k]) => k === 'id')?.[1] ?? '')}`)
}

describe('gatedExecute', () => {
  test('runs the original execute when askPermission returns "allow"', async () => {
    const ask: AskPermissionFn = () => Promise.resolve('allow')
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    const result = await gated({ id: 'X', _permission_reason: 'because' }, toolOpts)
    expect(result).toBe('ran:X')
  })

  test('strips _permission_reason before forwarding to original execute', async () => {
    let seen: unknown = null
    const recorder = (input: unknown): Promise<string> => {
      seen = input
      return Promise.resolve('ok')
    }
    const ask: AskPermissionFn = () => Promise.resolve('allow')
    const gated = gatedExecute(recorder, 'demo_tool', ask)
    await gated({ id: 'X', _permission_reason: 'r' }, toolOpts)
    expect(seen).toEqual({ id: 'X' })
  })

  test('returns permission_denied when askPermission returns "deny"', async () => {
    const ask: AskPermissionFn = () => Promise.resolve('deny')
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    const result = await gated({ id: 'X', _permission_reason: 'r' }, toolOpts)
    expect(result).toMatchObject({
      status: 'permission_denied',
      message: expect.stringContaining('demo_tool') as unknown,
    })
  })

  test('returns permission_denied when askPermission is undefined (no chat surface)', async () => {
    const gated = gatedExecute(fakeExecute, 'demo_tool', undefined)
    const result = await gated({ id: 'X', _permission_reason: 'r' }, toolOpts)
    expect(result).toMatchObject({
      status: 'permission_denied',
      message: expect.stringContaining('no chat surface') as unknown,
    })
  })

  test('passes toolName and reason to askPermission', async () => {
    let captured: { toolName: string; reason: string } | null = null
    const ask: AskPermissionFn = (req) => {
      captured = req
      return Promise.resolve('allow')
    }
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    await gated({ id: 'X', _permission_reason: 'cleanup' }, toolOpts)
    expect(captured).toMatchObject({ toolName: 'demo_tool', reason: 'cleanup' })
  })
})
