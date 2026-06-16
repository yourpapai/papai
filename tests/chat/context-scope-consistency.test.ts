// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ENTITY_SCOPES } from '../../src/chat/context-scope.js'
import { CONTEXT_OWNED_COLUMNS } from '../../src/db/migrations/scoped-context-owned-columns.js'

const key = (t: string, c: string): string => `${t}.${c}`

const ownedFlagByKey = new Map(CONTEXT_OWNED_COLUMNS.map((c) => [key(c.table, c.column), c.threadScoped]))

const rawThreadScopedMismatches = ENTITY_SCOPES.flatMap((entry) => {
  const flag = ownedFlagByKey.get(key(entry.table, entry.column))
  return flag !== undefined && flag !== entry.rawThreadScoped
    ? [`${key(entry.table, entry.column)}: registry=${entry.rawThreadScoped} owned=${flag}`]
    : []
})

const threadEntitiesNotRawThreadScoped = ENTITY_SCOPES.flatMap((e) =>
  e.scope === 'thread' && !e.rawThreadScoped ? [key(e.table, e.column)] : [],
)

const declaredKeys = new Set(ENTITY_SCOPES.map((e) => key(e.table, e.column)))

const missingFromRegistry = CONTEXT_OWNED_COLUMNS.flatMap((c) =>
  declaredKeys.has(key(c.table, c.column)) ? [] : [key(c.table, c.column)],
)

describe('ENTITY_SCOPES reconciliation', () => {
  test('rawThreadScoped matches CONTEXT_OWNED_COLUMNS.threadScoped for every shared (table,column)', () => {
    expect(rawThreadScopedMismatches).toEqual([])
  })

  test('every effective-thread entity is rawThreadScoped', () => {
    expect(threadEntitiesNotRawThreadScoped).toEqual([])
  })

  test('every CONTEXT_OWNED_COLUMNS entry is declared in the registry', () => {
    expect(missingFromRegistry).toEqual([])
  })
})
