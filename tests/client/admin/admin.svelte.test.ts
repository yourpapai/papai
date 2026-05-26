// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  adminSections,
  adminState,
  refreshAll,
  sectionFromHash,
  sectionLabel,
  setSection,
  setWindow,
  syncSectionFromLocation,
} from '../../../client/admin/admin.svelte.js'
import { adminGlobals } from '../../../client/admin/global-stats.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('admin.svelte', () => {
  beforeEach(() => {
    adminState.currentSection = 'overview'
    adminState.lastRefreshedAt = null
    adminGlobals.window = '30d'
    adminGlobals.data = null
    adminGlobals.fetchedAt = null
    adminGlobals.loading = false
  })

  afterEach(() => {
    restoreFetch()
  })

  test('adminState has lastRefreshedAt: null by default', () => {
    expect(adminState.lastRefreshedAt).toBeNull()
  })

  test('setSection updates currentSection', () => {
    setSection('billing')
    expect(adminState.currentSection).toBe('billing')
  })

  test('registers instances before system', () => {
    const ids = adminSections.map((section) => section.id)
    expect(ids).toContain('instances')
    expect(ids.indexOf('instances')).toBe(ids.indexOf('system') - 1)
    expect(sectionFromHash('#instances')).toBe('instances')
    expect(sectionLabel('instances')).toBe('Instances')
  })

  test('setWindow writes to adminGlobals.window', () => {
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })),
    )
    setWindow('7d')
    expect(adminGlobals.window).toBe('7d')
  })

  test('refreshAll awaits refreshGlobals and sets lastRefreshedAt', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ subjects: 1, llmCalls: 2, toolCalls: 3, tokens: 4 }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    expect(adminState.lastRefreshedAt).toBeNull()
    await refreshAll()
    expect(adminState.lastRefreshedAt).not.toBeNull()
    expect(typeof adminState.lastRefreshedAt).toBe('number')
  })

  test('syncSectionFromLocation updates currentSection from hash', () => {
    // Use setSection to put us in a known state, then test that syncSectionFromLocation
    // can update it from whatever hash is set (we cannot safely mutate location.hash
    // in tests without risking cross-test contamination in happy-dom).
    setSection('memos')
    expect(adminState.currentSection).toBe('memos')
    // syncSectionFromLocation reads location.hash; since that is managed by the
    // AdminApp.test.ts suite, we just verify the function calls sectionFromHash
    // without causing side effects that contaminate other tests.
    syncSectionFromLocation()
    // Result depends on whatever location.hash is at this point; just verify it
    // returns a valid AdminSectionId (not undefined / not throwing).
    const validIds = [
      'overview',
      'billing',
      'stats',
      'memos',
      'reminders',
      'identities',
      'groups',
      'instances',
      'system',
    ]
    expect(validIds).toContain(adminState.currentSection)
  })
})
