// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'
import { jsonSchema } from 'ai'
import { z } from 'zod'

import {
  PERMISSION_REASON_FIELD,
  extendSchemaForAsk,
  stripPermissionReason,
  type ExecuteFn,
} from '../../src/tools/permission-gate.js'

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

const toolOpts: ToolExecutionOptions<unknown> = { toolCallId: 't1', messages: [], context: {} }

describe('stripPermissionReason', () => {
  test('removes _permission_reason before the tool body runs', async () => {
    let seen: unknown = null
    const execute: ExecuteFn<string> = (input) => {
      seen = input
      return Promise.resolve('ok')
    }
    const stripped = stripPermissionReason(execute)

    await expect(stripped({ id: 'X', _permission_reason: 'because' }, toolOpts)).resolves.toBe('ok')
    expect(seen).toEqual({ id: 'X' })
  })

  test('passes non-object input through unchanged', async () => {
    let seen: unknown = null
    const execute: ExecuteFn<string> = (input) => {
      seen = input
      return Promise.resolve('ok')
    }
    const stripped = stripPermissionReason(execute)

    await stripped('raw-input', toolOpts)
    expect(seen).toBe('raw-input')
  })

  test('executes without any approval step', async () => {
    let calls = 0
    const execute: ExecuteFn<string> = () => {
      calls += 1
      return Promise.resolve('ran')
    }
    const stripped = stripPermissionReason(execute)

    await expect(stripped({ id: 'X' }, toolOpts)).resolves.toBe('ran')
    expect(calls).toBe(1)
  })
})
