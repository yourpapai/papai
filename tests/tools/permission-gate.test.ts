// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { jsonSchema } from 'ai'
import { z } from 'zod'

import { buildPermissionDenied, PERMISSION_REASON_FIELD, extendSchemaForAsk } from '../../src/tools/permission-gate.js'

describe('buildPermissionDenied', () => {
  test('returns structured permission_denied shape', () => {
    const result = buildPermissionDenied('User denied the call.')
    expect(result).toEqual({ status: 'permission_denied', message: 'User denied the call.' })
  })
})

describe('extendSchemaForAsk (Zod input)', () => {
  test('adds required _permission_reason field and rejects without it', () => {
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

describe('extendSchemaForAsk (jsonSchema/MCP input)', () => {
  const baseJsonSchema = { type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id'] }

  test('returns a schema wrapper with both id and _permission_reason in properties', () => {
    const wrapped = jsonSchema(baseJsonSchema)
    const extended = extendSchemaForAsk(wrapped)
    expect(extended).toMatchObject({
      jsonSchema: {
        properties: {
          id: expect.anything() as unknown,
          [PERMISSION_REASON_FIELD]: expect.anything() as unknown,
        },
      },
    })
  })

  test('includes _permission_reason in required array', () => {
    const wrapped = jsonSchema(baseJsonSchema)
    const extended = extendSchemaForAsk(wrapped)
    expect(extended).toMatchObject({
      jsonSchema: {
        required: expect.arrayContaining(['id', PERMISSION_REASON_FIELD]) as unknown,
      },
    })
  })

  test('preserves original required fields in extended schema', () => {
    const wrapped = jsonSchema(baseJsonSchema)
    const extended = extendSchemaForAsk(wrapped)
    expect(extended).toMatchObject({
      jsonSchema: {
        required: expect.arrayContaining(['id']) as unknown,
      },
    })
  })
})

import type { ToolExecutionOptions } from 'ai'

import { type AskPermissionFn, gatedExecute } from '../../src/tools/permission-gate.js'

const toolOpts: ToolExecutionOptions = { toolCallId: 't1', messages: [] }

function fakeExecute(input: unknown, _opts: ToolExecutionOptions): Promise<string> {
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
    const recorder = (input: unknown, _opts: ToolExecutionOptions): Promise<string> => {
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

  test('passes toolName, reason, and args to askPermission', async () => {
    let captured: { toolName: string; reason: string; args: Record<string, unknown> } | null = null
    const ask: AskPermissionFn = (req) => {
      captured = req
      return Promise.resolve('allow')
    }
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    await gated({ id: 'X', _permission_reason: 'cleanup' }, toolOpts)
    expect(captured).toMatchObject({ toolName: 'demo_tool', reason: 'cleanup', args: { id: 'X' } })
  })
})
