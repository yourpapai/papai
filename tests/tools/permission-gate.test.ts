// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { jsonSchema } from 'ai'
import { z } from 'zod'

import {
  buildPermissionDenied,
  isPermissionDeniedResult,
  PERMISSION_REASON_FIELD,
  extendSchemaForAsk,
} from '../../src/tools/permission-gate.js'

describe('isPermissionDeniedResult', () => {
  test('recognizes the structured denial shape', () => {
    expect(isPermissionDeniedResult(buildPermissionDenied('no'))).toBe(true)
  })

  test('rejects non-denial values', () => {
    expect(isPermissionDeniedResult(undefined)).toBe(false)
    expect(isPermissionDeniedResult(null)).toBe(false)
    expect(isPermissionDeniedResult({ status: 'ok' })).toBe(false)
    expect(isPermissionDeniedResult({ status: 'permission_denied' })).toBe(false)
    expect(isPermissionDeniedResult('permission_denied')).toBe(false)
  })

  test('rejects an object whose status is not permission_denied even with a string message', () => {
    expect(isPermissionDeniedResult({ status: 'other_status', message: 'hi' })).toBe(false)
  })

  test('rejects a permission_denied object whose message is not a string', () => {
    expect(isPermissionDeniedResult({ status: 'permission_denied', message: 7 })).toBe(false)
  })
})

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

const toolOpts: ToolExecutionOptions<unknown> = { toolCallId: 't1', messages: [], context: {} }

function fakeExecute(input: unknown, _opts: ToolExecutionOptions<unknown>): Promise<string> {
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
    const recorder = (input: unknown, _opts: ToolExecutionOptions<unknown>): Promise<string> => {
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

type SafeParseSchema = { safeParse: (data: unknown) => { success: boolean } }
type JsonSchemaWrapper = { jsonSchema: Record<string, unknown> }

function hasSafeParse(s: unknown): s is SafeParseSchema {
  return s !== null && typeof s === 'object' && 'safeParse' in s
}

function isJsonSchemaWrapper(s: unknown): s is JsonSchemaWrapper {
  return s !== null && typeof s === 'object' && 'jsonSchema' in s
}

function isStringRecord(s: unknown): s is Record<string, unknown> {
  return s !== null && typeof s === 'object'
}

function requireSafeParse(s: unknown): SafeParseSchema {
  if (!hasSafeParse(s)) throw new Error('expected a schema with safeParse')
  return s
}

function requireJsonSchema(s: unknown): JsonSchemaWrapper {
  if (!isJsonSchemaWrapper(s)) throw new Error('expected a jsonSchema wrapper')
  return s
}

function permissionReasonDescription(s: unknown): unknown {
  const json = requireJsonSchema(s).jsonSchema
  const properties = json['properties']
  if (!isStringRecord(properties)) throw new Error('expected properties record')
  const field = properties[PERMISSION_REASON_FIELD]
  if (!isStringRecord(field)) throw new Error('expected _permission_reason property')
  return field['description']
}

describe('extendSchemaForAsk (missing JSON shape fallback)', () => {
  test('returns a usable fallback Zod schema for a null schema', () => {
    const extended = requireSafeParse(extendSchemaForAsk(null))
    expect(extended.safeParse({ [PERMISSION_REASON_FIELD]: 'rr' }).success).toBe(true)
    expect(extended.safeParse({}).success).toBe(false)
  })

  test('returns a usable fallback Zod schema for a non-object schema value', () => {
    const extended = requireSafeParse(extendSchemaForAsk('not-a-schema'))
    expect(extended.safeParse({ [PERMISSION_REASON_FIELD]: 'rr' }).success).toBe(true)
  })

  test('returns a usable fallback Zod schema when the wrapped jsonSchema is not a record', () => {
    const extended = requireSafeParse(extendSchemaForAsk({ jsonSchema: 'nope' }))
    expect(extended.safeParse({ [PERMISSION_REASON_FIELD]: 'rr' }).success).toBe(true)
  })
})

describe('extendSchemaForAsk (jsonSchema merge fidelity)', () => {
  test('appends only _permission_reason to required when the source has no required array', () => {
    const json = requireJsonSchema(extendSchemaForAsk(jsonSchema({ type: 'object' }))).jsonSchema
    expect(JSON.stringify(json['required'])).toBe(JSON.stringify([PERMISSION_REASON_FIELD]))
  })

  test('drops non-string entries from required before appending _permission_reason', () => {
    const source = { jsonSchema: { type: 'object', required: ['id', 9, true] } }
    const json = requireJsonSchema(extendSchemaForAsk(source)).jsonSchema
    expect(JSON.stringify(json['required'])).toBe(JSON.stringify(['id', PERMISSION_REASON_FIELD]))
  })

  test('forces the merged schema type to object', () => {
    const json = requireJsonSchema(extendSchemaForAsk(jsonSchema({ type: 'object' }))).jsonSchema
    expect(json['type']).toBe('object')
  })

  test('carries the full _permission_reason description verbatim', () => {
    const description = permissionReasonDescription(extendSchemaForAsk(jsonSchema({ type: 'object' })))
    expect(description).toBe(
      'Brief, user-facing reason this tool call is needed. ' +
        'Shown verbatim in the permission prompt. ' +
        'One sentence, present tense, no markdown.',
    )
  })
})

describe('gatedExecute input handling', () => {
  test('treats a missing _permission_reason as an empty reason passed to askPermission', async () => {
    const captured: { reason: string } = { reason: '' }
    const ask: AskPermissionFn = (req) => {
      captured.reason = req.reason
      return Promise.resolve('deny')
    }
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    await gated({ id: 'X' }, toolOpts)
    expect(captured.reason).toBe('')
  })

  test('coerces a non-object string input into empty args for askPermission', async () => {
    let capturedArgs: Record<string, unknown> | null = null
    const ask: AskPermissionFn = (req) => {
      capturedArgs = req.args
      return Promise.resolve('deny')
    }
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    await gated('not-an-object', toolOpts)
    expect(JSON.stringify(capturedArgs)).toBe('{}')
  })

  test('coerces a null input into empty args for askPermission without throwing', async () => {
    let capturedArgs: Record<string, unknown> | null = null
    const ask: AskPermissionFn = (req) => {
      capturedArgs = req.args
      return Promise.resolve('deny')
    }
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    await gated(null, toolOpts)
    expect(JSON.stringify(capturedArgs)).toBe('{}')
  })
})
