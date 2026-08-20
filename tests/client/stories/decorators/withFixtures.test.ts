// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { adminState } from '../../../../client/admin/admin.svelte.js'
import { adminGlobals } from '../../../../client/admin/global-stats.svelte.js'
import { settingsSession } from '../../../../client/settings/session.svelte.js'
import {
  applyGateSettingsSession,
  applyReadySettingsSession,
  fixturesLoader,
  resetAllSingletons,
  resetSettingsSession,
  resolveScenario,
} from '../../../../client/stories/decorators/withFixtures.js'
import { sseStub } from '../../../../client/stories/stubs/sse.js'

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

  test('applyReadySettingsSession(admin) sets a personal context with both admin flags true', () => {
    resetSettingsSession()

    applyReadySettingsSession('admin')

    const status: string = settingsSession.status
    expect(status).toBe('ready')
    expect(settingsSession.display).toBe('Alice')
    expect(settingsSession.isBotAdmin).toBe(true)
    expect(settingsSession.isSuperAdmin).toBe(true)
    expect(settingsSession.contexts).toHaveLength(1)
    const ctx = settingsSession.contexts[0]
    expect(ctx?.kind).toBe('personal')
    expect(ctx?.contextId).toBe('ctx-personal-1')
    expect(settingsSession.activeContextId).toBe('ctx-personal-1')
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

  test('applyGateSettingsSession(unauthenticated) sets status with no failure message', () => {
    resetSettingsSession()

    applyGateSettingsSession('unauthenticated')

    const status: string = settingsSession.status
    expect(status).toBe('unauthenticated')
    expect(settingsSession.failureMessage).toBe('')
  })

  test('applyGateSettingsSession(failed) sets status with a failure message', () => {
    resetSettingsSession()

    applyGateSettingsSession('failed')

    const status: string = settingsSession.status
    expect(status).toBe('failed')
    expect(settingsSession.failureMessage).toBe('request failed with status 503')
  })

  test('fixturesLoader does nothing when the fixtures parameter is not a string', async () => {
    resetSettingsSession()

    const result = await fixturesLoader({ parameters: {} })

    expect(result).toEqual({})
    const status: string = settingsSession.status
    expect(status).toBe('loading')
  })

  test('fixturesLoader applies the unauthenticated gate from settingsGate', async () => {
    resetSettingsSession()

    await fixturesLoader({ parameters: { fixtures: 'admin-populated', settingsGate: 'unauthenticated' } })

    const status: string = settingsSession.status
    expect(status).toBe('unauthenticated')
    expect(settingsSession.failureMessage).toBe('')
  })

  test('fixturesLoader applies the failed gate from settingsGate', async () => {
    resetSettingsSession()

    await fixturesLoader({ parameters: { fixtures: 'admin-populated', settingsGate: 'failed' } })

    const status: string = settingsSession.status
    expect(status).toBe('failed')
    expect(settingsSession.failureMessage).toBe('request failed with status 503')
  })

  test('fixturesLoader ignores an unrecognized settingsGate value', async () => {
    resetSettingsSession()

    await fixturesLoader({ parameters: { fixtures: 'admin-populated', settingsGate: 'bogus' } })

    const status: string = settingsSession.status
    expect(status).toBe('loading')
  })

  test('fixturesLoader with settingsReady: true applies the personal ready session', async () => {
    resetSettingsSession()

    await fixturesLoader({ parameters: { fixtures: 'admin-populated', settingsReady: true } })

    const status: string = settingsSession.status
    expect(status).toBe('ready')
    const ctx = settingsSession.contexts[0]
    expect(ctx?.kind).toBe('personal')
  })

  test('fixturesLoader with settingsReady: "admin" applies the admin ready session', async () => {
    resetSettingsSession()

    await fixturesLoader({ parameters: { fixtures: 'admin-populated', settingsReady: 'admin' } })

    expect(settingsSession.isBotAdmin).toBe(true)
    expect(settingsSession.isSuperAdmin).toBe(true)
  })

  test('fixturesLoader with settingsReady: "group" applies the group ready session', async () => {
    resetSettingsSession()

    await fixturesLoader({ parameters: { fixtures: 'admin-populated', settingsReady: 'group' } })

    const ctx = settingsSession.contexts[0]
    expect(ctx?.kind).toBe('group')
  })

  test('fixturesLoader seeds SSE events from sseSeed', async () => {
    resetSettingsSession()
    sseStub.reset()

    await fixturesLoader({
      parameters: { fixtures: 'admin-populated', sseSeed: [{ type: 'ping', payload: { ok: true } }] },
    })

    expect(sseStub.history()).toEqual([{ type: 'ping', payload: { ok: true } }])
  })

  test('fixturesLoader does not seed SSE events when sseSeed is not an array', async () => {
    resetSettingsSession()
    sseStub.reset()

    await fixturesLoader({ parameters: { fixtures: 'admin-populated', sseSeed: 'not-an-array' } })

    expect(sseStub.history()).toEqual([])
  })

  test('fixturesLoader skips MSW setup when no worker is present on the context', async () => {
    resetSettingsSession()

    const result = await fixturesLoader({ parameters: { fixtures: 'admin-populated' } })

    expect(result).toEqual({})
  })
})
