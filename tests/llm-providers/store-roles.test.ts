// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmAdminRoles } from '../../src/db/schema.js'
import {
  clearRoleBindingsCacheForTesting,
  getAdminRoleBindings,
  setAdminRoleBindings,
} from '../../src/llm-providers/store-roles.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  clearRoleBindingsCacheForTesting()
})

describe('llm-providers store roles', () => {
  test('getAdminRoleBindings returns null when unset', () => {
    expect(getAdminRoleBindings()).toBeNull()
  })

  test('setAdminRoleBindings persists main, small, and embedding and reads them back', () => {
    setAdminRoleBindings(
      {
        main: { providerId: 'prov-main', model: 'gpt-main' },
        small: { providerId: 'prov-small', model: 'gpt-small' },
        embedding: { providerId: 'prov-embed', model: 'text-embed' },
      },
      'admin-1',
    )

    expect(getAdminRoleBindings()).toEqual({
      main: { providerId: 'prov-main', model: 'gpt-main' },
      small: { providerId: 'prov-small', model: 'gpt-small' },
      embedding: { providerId: 'prov-embed', model: 'text-embed' },
    })
  })

  test('a second set with null small/embedding stores them as null', () => {
    setAdminRoleBindings(
      { main: { providerId: 'prov-main', model: 'gpt-main' }, small: null, embedding: null },
      'admin-1',
    )

    expect(getAdminRoleBindings()).toEqual({
      main: { providerId: 'prov-main', model: 'gpt-main' },
      small: null,
      embedding: null,
    })
  })

  test('clearRoleBindingsCacheForTesting forces the next read back to the database', () => {
    setAdminRoleBindings(
      { main: { providerId: 'prov-main', model: 'gpt-main' }, small: null, embedding: null },
      'admin-1',
    )
    getAdminRoleBindings()
    getDrizzleDb().update(llmAdminRoles).set({ mainModel: 'gpt-rotated' }).where(eq(llmAdminRoles.id, 1)).run()

    expect(getAdminRoleBindings()?.main.model).toBe('gpt-main')

    clearRoleBindingsCacheForTesting()
    expect(getAdminRoleBindings()?.main.model).toBe('gpt-rotated')
  })
})
