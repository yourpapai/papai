// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { adminState } from '../../../../client/admin/admin.svelte.js'
import { adminGlobals } from '../../../../client/admin/global-stats.svelte.js'
import { settingsSession } from '../../../../client/settings/session.svelte.js'
import {
  applyReadySettingsSession,
  resetAllSingletons,
  resetSettingsSession,
  resolveScenario,
} from '../../../../client/stories/decorators/withFixtures.js'

describe('withFixtures', () => {
  test('resolveScenario returns a matching handler bundle for a known name', () => {
    expect(resolveScenario('admin-populated').length).toBeGreaterThan(0)
  })

  test('resolveScenario returns an empty bundle for an unknown name', () => {
    expect(resolveScenario('does-not-exist')).toEqual([])
  })

  test('resetSettingsSession restores settingsSession to baseline', () => {
    settingsSession.status = 'ready'
    settingsSession.display = 'x'
    settingsSession.isBotAdmin = true
    settingsSession.isSuperAdmin = true
    settingsSession.contexts = [{ kind: 'personal', contextId: 'ctx-1', label: 'test' }]
    settingsSession.activeContextId = 'ctx-1'

    resetSettingsSession()

    const status: string = settingsSession.status
    expect(status).toBe('loading')
    expect(settingsSession.display).toBe('')
    expect(settingsSession.isBotAdmin).toBe(false)
    expect(settingsSession.isSuperAdmin).toBe(false)
    expect(settingsSession.contexts).toEqual([])
    expect(settingsSession.activeContextId).toBe('')
  })

  test('applyReadySettingsSession(group) sets a group context on settingsSession', () => {
    resetSettingsSession()

    applyReadySettingsSession('group')

    const status: string = settingsSession.status
    expect(status).toBe('ready')
    expect(settingsSession.display).toBe('Alice')
    expect(settingsSession.isBotAdmin).toBe(false)
    expect(settingsSession.isSuperAdmin).toBe(false)
    expect(settingsSession.contexts).toHaveLength(1)
    const ctx = settingsSession.contexts[0]
    expect(ctx?.kind).toBe('group')
    expect(ctx?.contextId).toBe('ctx-group-1')
    expect(settingsSession.activeContextId).toBe('ctx-group-1')
  })

  test('resetAllSingletons restores admin rune singletons to defaults', () => {
    adminState.currentSection = 'billing'
    adminState.lastRefreshedAt = 123
    adminGlobals.window = '7d'
    adminGlobals.fetchedAt = 456

    resetAllSingletons()

    const section: string = adminState.currentSection
    const windowValue: string = adminGlobals.window
    expect(section).toBe('overview')
    expect(adminState.lastRefreshedAt).toBeNull()
    expect(windowValue).toBe('30d')
    expect(adminGlobals.fetchedAt).toBeNull()
    expect(adminGlobals.data).toBeNull()
  })
})
