// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import {
  alertConditionInputSchema,
  alertConditionSchema,
  parseConditionInput,
} from '../../src/deferred-prompts/condition-schema.js'
import type { AlertCondition } from '../../src/deferred-prompts/condition-schema.js'

const FIELD_LEAF: AlertCondition = { field: 'task.status', op: 'eq', value: 'open' }
const FIELD_LEAF_JSON = '{"field":"task.status","op":"eq","value":"open"}'
const ACTIVITY_LEAF: AlertCondition = { kind: 'activity', taskId: '417' }
const ACTIVITY_LEAF_JSON = '{"kind":"activity","taskId":"417"}'

describe('alertConditionInputSchema', () => {
  test('field leaf object validates to itself', () => {
    const result = alertConditionInputSchema.safeParse(FIELD_LEAF)
    expect(result.success).toBe(true)
    assert(result.success, 'expected the field leaf object to validate')
    expect(result.data).toEqual(FIELD_LEAF)
  })

  test('activity leaf object validates to itself', () => {
    const result = alertConditionInputSchema.safeParse(ACTIVITY_LEAF)
    expect(result.success).toBe(true)
    assert(result.success, 'expected the activity leaf object to validate')
    expect(result.data).toEqual(ACTIVITY_LEAF)
  })

  test('condition-invalid object is still rejected', () => {
    const result = alertConditionInputSchema.safeParse({ field: 'task.status', op: 'bogus', value: 'open' })
    expect(result.success).toBe(false)
  })

  test('JSON-encoded condition string is accepted unchanged (no schema-level coercion)', () => {
    const result = alertConditionInputSchema.safeParse(FIELD_LEAF_JSON)
    expect(result.success).toBe(true)
    assert(result.success, 'expected the JSON-encoded condition string to be accepted')
    expect(result.data).toBe(FIELD_LEAF_JSON)
  })
})

describe('alertConditionSchema stays object-only', () => {
  test('condition strings are not accepted by the canonical storage schema', () => {
    expect(alertConditionSchema.safeParse(FIELD_LEAF_JSON).success).toBe(false)
    expect(alertConditionSchema.safeParse(ACTIVITY_LEAF_JSON).success).toBe(false)
  })
})

describe('parseConditionInput', () => {
  test('JSON-string field leaf coerces to the canonical object', () => {
    const result = parseConditionInput(FIELD_LEAF_JSON)
    expect(result.success).toBe(true)
    assert(result.success, 'expected the JSON-string field leaf to coerce')
    expect(result.data).toEqual(FIELD_LEAF)
  })

  test('JSON-string activity leaf coerces to the canonical object', () => {
    const result = parseConditionInput(ACTIVITY_LEAF_JSON)
    expect(result.success).toBe(true)
    assert(result.success, 'expected the JSON-string activity leaf to coerce')
    expect(result.data).toEqual(ACTIVITY_LEAF)
  })

  test('object input passes through the object schema unchanged', () => {
    const result = parseConditionInput(FIELD_LEAF)
    expect(result.success).toBe(true)
    assert(result.success, 'expected the object input to pass through')
    expect(result.data).toEqual(FIELD_LEAF)
  })

  test('non-JSON string is rejected with a JSON-specific reason', () => {
    const result = parseConditionInput('not json at all')
    expect(result.success).toBe(false)
    assert(!result.success, 'expected the non-JSON string to be rejected')
    expect(result.error.startsWith('Invalid condition: value is not valid JSON')).toBe(true)
  })

  test('JSON string with an unknown operator is rejected with the schema reason', () => {
    const result = parseConditionInput('{"field":"task.status","op":"bogus","value":"open"}')
    expect(result.success).toBe(false)
    assert(!result.success, 'expected the unknown-operator string to be rejected')
    expect(result.error.startsWith('Invalid condition: ')).toBe(true)
    expect(result.error).toContain("Invalid operator 'bogus' for field 'task.status'")
  })

  test('JSON activity string without taskId is rejected with the taskId reason', () => {
    const result = parseConditionInput('{"kind":"activity"}')
    expect(result.success).toBe(false)
    assert(!result.success, 'expected the activity string without taskId to be rejected')
    expect(result.error.startsWith('Invalid condition: ')).toBe(true)
    expect(result.error).toContain('Activity conditions require a taskId.')
  })

  test('condition-invalid strings reject with the same reason as the equivalent object', () => {
    const objectResult = parseConditionInput({ field: 'task.status', op: 'bogus', value: 'open' })
    const stringResult = parseConditionInput('{"field":"task.status","op":"bogus","value":"open"}')
    assert(!objectResult.success, 'expected the object form to be rejected')
    assert(!stringResult.success, 'expected the string form to be rejected')
    expect(stringResult.error).toBe(objectResult.error)
  })

  test('non-string non-object input is rejected via the object schema', () => {
    const result = parseConditionInput(42)
    expect(result.success).toBe(false)
    assert(!result.success, 'expected the non-string non-object input to be rejected')
    expect(result.error.startsWith('Invalid condition: ')).toBe(true)
  })
})

type ConditionJsonSchemaNode = z.core.JSONSchema.BaseSchema
type ConditionJsonSchemaDefs = NonNullable<z.core.JSONSchema.BaseSchema['$defs']>

const conditionAnyOfOf = (jsonSchema: z.core.JSONSchema.BaseSchema): ConditionJsonSchemaNode[] => {
  const conditionProperty = jsonSchema.properties?.['condition']
  if (typeof conditionProperty !== 'object' || conditionProperty === null) return []
  return conditionProperty.anyOf ?? []
}

const resolvedConditionVariants = (
  defs: ConditionJsonSchemaDefs | undefined,
  variants: readonly ConditionJsonSchemaNode[],
): ConditionJsonSchemaNode[] =>
  variants.map((variant) => defs?.[variant.$ref?.replace('#/$defs/', '') ?? ''] ?? variant)

const conditionObjectVariants = (variants: readonly ConditionJsonSchemaNode[]): ConditionJsonSchemaNode[] =>
  variants.filter((variant) => variant.type !== 'string').flatMap((variant) => variant.anyOf ?? [variant])

describe('tool input JSON-Schema representability (design D2)', () => {
  test('z.toJSONSchema over the assembled tool input union does not throw and its condition anyOf contains object variants plus a string variant', () => {
    const assembledInputSchema = z.object({ condition: alertConditionInputSchema })
    const jsonSchema = z.toJSONSchema(assembledInputSchema)

    const conditionAnyOf = conditionAnyOfOf(jsonSchema)
    assert(conditionAnyOf.length >= 2, 'expected the condition property to convert to an anyOf of both condition forms')

    const variants = resolvedConditionVariants(jsonSchema.$defs, conditionAnyOf)
    assert(
      variants.every((variant) => variant.$ref === undefined),
      'expected every $ref in the condition anyOf to resolve into $defs',
    )
    assert(
      variants.some((variant) => variant.type === 'string'),
      'expected the condition anyOf to contain a string variant',
    )

    const objectVariants = conditionObjectVariants(variants)
    assert(objectVariants.length >= 4, 'expected the canonical condition object variants under the condition anyOf')
    assert(
      objectVariants.every((variant) => variant.type === 'object'),
      'expected every condition object variant to be object-typed',
    )
  })
})
