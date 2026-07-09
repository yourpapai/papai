// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  applyModuleSectionUnset,
  applyModuleSectionUpdate,
  buildModuleSectionDescriptors,
  getModuleSectionsSnapshot,
  ModuleSectionConfigError,
} from '../../src/debug/admin-module-sections.js'
import { getPluginAdminConfig } from '../../src/plugins/store.js'
import { moduleSettingsRegistry } from '../../src/ports/settings-sections.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  moduleSettingsRegistry.clear()
  moduleSettingsRegistry.register([
    {
      id: 'acp',
      label: 'Coding sessions (magi)',
      fields: [
        { key: 'magi_base_url', label: 'Magi Base URL', required: true },
        { key: 'magi_token', label: 'Magi Token', required: true, sensitive: true },
      ],
    },
  ])
})

afterEach(() => {
  moduleSettingsRegistry.clear()
})

describe('admin module sections', () => {
  test('snapshot lists declared fields with null values before any are set', () => {
    const snap = getModuleSectionsSnapshot(buildModuleSectionDescriptors())
    const acp = snap.sections.find((s) => s.id === 'acp')
    expect(acp?.fields.map((f) => f.key)).toEqual(['magi_base_url', 'magi_token'])
    expect(acp?.fields.every((f) => f.value === null)).toBe(true)
  })

  test('update writes the value; snapshot masks a sensitive field', () => {
    applyModuleSectionUpdate(
      { id: 'acp', key: 'magi_token', value: 'secrettoken1234' },
      'admin-user',
      buildModuleSectionDescriptors(),
    )
    expect(getPluginAdminConfig('acp', 'magi_token')).toBe('secrettoken1234')
    const snap = getModuleSectionsSnapshot(buildModuleSectionDescriptors())
    const token = snap.sections.find((s) => s.id === 'acp')?.fields.find((f) => f.key === 'magi_token')
    expect(token?.value).toBe('****1234')
  })

  test('non-sensitive field is returned unmasked', () => {
    applyModuleSectionUpdate(
      { id: 'acp', key: 'magi_base_url', value: 'https://magi.example' },
      'admin-user',
      buildModuleSectionDescriptors(),
    )
    const snap = getModuleSectionsSnapshot(buildModuleSectionDescriptors())
    const url = snap.sections.find((s) => s.id === 'acp')?.fields.find((f) => f.key === 'magi_base_url')
    expect(url?.value).toBe('https://magi.example')
  })

  test('rejects an unknown section id', () => {
    expect(() =>
      applyModuleSectionUpdate(
        { id: 'nope', key: 'magi_token', value: 'x' },
        'admin-user',
        buildModuleSectionDescriptors(),
      ),
    ).toThrow(ModuleSectionConfigError)
  })

  test('rejects an undeclared key', () => {
    expect(() =>
      applyModuleSectionUpdate(
        { id: 'acp', key: 'not_a_field', value: 'x' },
        'admin-user',
        buildModuleSectionDescriptors(),
      ),
    ).toThrow(ModuleSectionConfigError)
  })

  test('rejects an empty value', () => {
    expect(() =>
      applyModuleSectionUpdate(
        { id: 'acp', key: 'magi_base_url', value: '   ' },
        'admin-user',
        buildModuleSectionDescriptors(),
      ),
    ).toThrow(ModuleSectionConfigError)
  })

  test('unset removes the value', () => {
    applyModuleSectionUpdate(
      { id: 'acp', key: 'magi_base_url', value: 'https://m' },
      'admin-user',
      buildModuleSectionDescriptors(),
    )
    applyModuleSectionUnset({ id: 'acp', key: 'magi_base_url' }, 'admin-user', buildModuleSectionDescriptors())
    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBeUndefined()
  })
})
