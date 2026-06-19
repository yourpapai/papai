// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import {
  adminToolDefaultsContextId,
  getAdminToolDefaults,
  maybeSeedAdminToolDefaults,
} from '../../src/tools/admin-tool-defaults.js'
import { getToolPrefs, hasStoredToolPrefs, setToolPrefs, type ToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const PI = 'pi-1'
const DEFAULT: ToolPrefs = { riskDefaults: {}, domainDefaults: { web: 'deny' }, toolOverrides: {} }

describe('admin tool defaults', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('context id has the reserved prefix', () => {
    expect(adminToolDefaultsContextId(PI)).toBe('__admin_tool_defaults__:pi-1')
  })

  test('getAdminToolDefaults returns null when unset, prefs when set', () => {
    expect(getAdminToolDefaults(PI)).toBeNull()
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    expect(getAdminToolDefaults(PI)).toEqual(DEFAULT)
  })

  test('getAdminToolDefaults treats empty prefs as no default', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), { riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
    expect(getAdminToolDefaults(PI)).toBeNull()
  })

  test('seeds a fresh scoped context once from the instance default', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'user-1' })
    expect(hasStoredToolPrefs(ctx)).toBe(false)
    maybeSeedAdminToolDefaults(ctx)
    expect(hasStoredToolPrefs(ctx)).toBe(true)
    expect(getToolPrefs(ctx)).toEqual(DEFAULT)
  })

  test('does not overwrite an existing context', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'user-1' })
    const own: ToolPrefs = { riskDefaults: {}, domainDefaults: {}, toolOverrides: { web_fetch: 'allow' } }
    setToolPrefs(ctx, own)
    maybeSeedAdminToolDefaults(ctx)
    expect(getToolPrefs(ctx)).toEqual(own)
  })

  test('no-op when no admin default exists', () => {
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'user-2' })
    maybeSeedAdminToolDefaults(ctx)
    expect(hasStoredToolPrefs(ctx)).toBe(false)
  })

  test('no-op for a non-scoped context id', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    maybeSeedAdminToolDefaults('plain-user-id')
    expect(hasStoredToolPrefs('plain-user-id')).toBe(false)
  })

  test('no-op (no recursion) for the admin-default sentinel context', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    // Calling seed on the sentinel itself must not try to seed/parse it.
    maybeSeedAdminToolDefaults(adminToolDefaultsContextId(PI))
    expect(getAdminToolDefaults(PI)).toEqual(DEFAULT)
  })
})
