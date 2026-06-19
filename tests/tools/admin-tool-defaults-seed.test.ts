// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { adminToolDefaultsContextId } from '../../src/tools/admin-tool-defaults.js'
import { applyToolPreferences } from '../../src/tools/index.js'
import { getToolPrefs, setToolPrefs, type ToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const PI = 'pi-seed'
// web_fetch is domain 'web'; denying the domain removes it from the applied set.
const DENY_WEB: ToolPrefs = { riskDefaults: {}, domainDefaults: { web: 'deny' }, toolOverrides: {} }

function stubTools(): ToolSet {
  return {
    web_fetch: tool({
      description: 'stub web_fetch',
      inputSchema: z.object({}),
      execute: () => Promise.resolve('ok'),
    }),
  }
}

describe('admin default seeding via applyToolPreferences', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('seeds a fresh context and applies the default (web_fetch denied)', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DENY_WEB)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'u1' })
    const applied = applyToolPreferences(stubTools(), ctx, undefined)
    expect(applied['web_fetch']).toBeUndefined()
    expect(getToolPrefs(ctx)).toEqual(DENY_WEB)
  })

  test('does not re-seed after the user customizes', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DENY_WEB)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'u2' })
    // first build seeds DENY_WEB
    applyToolPreferences(stubTools(), ctx, undefined)
    setToolPrefs(ctx, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { web_fetch: 'allow' } })
    const applied = applyToolPreferences(stubTools(), ctx, undefined)
    // user override wins; no re-seed
    expect(applied['web_fetch']).toBeDefined()
  })

  test('later admin-default change does not affect an already-seeded context', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DENY_WEB)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'u3' })
    // seeds DENY_WEB
    applyToolPreferences(stubTools(), ctx, undefined)
    setToolPrefs(adminToolDefaultsContextId(PI), { riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
    const applied = applyToolPreferences(stubTools(), ctx, undefined)
    // still the seeded DENY_WEB
    expect(applied['web_fetch']).toBeUndefined()
  })

  test('no admin default => allow-all baseline (web_fetch present)', () => {
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'u4' })
    const applied = applyToolPreferences(stubTools(), ctx, undefined)
    expect(applied['web_fetch']).toBeDefined()
  })
})
