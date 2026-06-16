// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { z } from 'zod'

import { collectFieldPairs, resolveFieldPair } from '../../../plugins/task-provider-youtrack/create-field-helpers.js'
import type { ProjectCustomFieldSchema } from '../../../plugins/task-provider-youtrack/schemas/bundle.js'

type PCF = z.infer<typeof ProjectCustomFieldSchema> & { field: { name: string } }

const field = (name: string, typeId: string, bundleType?: string): PCF =>
  ({
    $type: 'ProjectCustomField',
    field: { name, fieldType: { id: typeId } },
    ...(bundleType === undefined ? {} : { bundle: { id: 'b-1', $type: bundleType } }),
  }) as PCF

const byName = (fields: PCF[]): Map<string, PCF> => new Map(fields.map((f) => [f.field.name, f]))

describe('collectFieldPairs', () => {
  test('tags dedicated params with a kind and generic fields by name', () => {
    const pairs = collectFieldPairs({ status: 'Open', customFields: [{ name: 'URL', value: 'http://x' }] })
    expect(pairs).toContainEqual({ source: 'dedicated', kind: 'state', value: 'Open' })
    expect(pairs).toContainEqual({ source: 'generic', name: 'URL', value: 'http://x' })
  })
})

describe('resolveFieldPair', () => {
  test('dedicated status resolves to the localized state field', () => {
    const state = field('Cтaтус', 'state[1]', 'StateBundle')
    const resolved = resolveFieldPair({ source: 'dedicated', kind: 'state', value: 'Open' }, byName([state]), 'create')
    expect(resolved.field.field?.name).toBe('Cтaтус')
    expect(resolved.value).toBe('Open')
  })

  test('generic unknown field throws a teaching error listing available names', () => {
    const state = field('Cтaтус', 'state[1]', 'StateBundle')
    expect(() => resolveFieldPair({ source: 'generic', name: 'Nope', value: 'x' }, byName([state]), 'create')).toThrow(
      /Cтaтус/u,
    )
  })
})
