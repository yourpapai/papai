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

  test('existing magi section serializes without the new descriptor attributes (behavior-preserving)', () => {
    const snap = getModuleSectionsSnapshot(buildModuleSectionDescriptors())
    const acp = snap.sections.find((s) => s.id === 'acp')
    expect(acp?.scope).toBeUndefined()
    expect(acp?.actions).toBeUndefined()
    const baseUrlField = acp?.fields.find((f) => f.key === 'magi_base_url')
    expect(baseUrlField?.control).toBeUndefined()
    expect(baseUrlField?.options).toBeUndefined()
    expect(baseUrlField?.actionId).toBeUndefined()
    const tokenField = acp?.fields.find((f) => f.key === 'magi_token')
    expect(tokenField?.control).toBeUndefined()
    expect(tokenField?.options).toBeUndefined()
    expect(tokenField?.actionId).toBeUndefined()
  })

  test('field-kind/scope/actions attributes round-trip into the serialized snapshot', () => {
    moduleSettingsRegistry.clear()
    moduleSettingsRegistry.register([
      {
        id: 'fabricated',
        label: 'Fabricated section',
        scope: 'group',
        actions: [{ id: 'provision', label: 'Provision', route: '/api/fabricated/provision', method: 'POST' }],
        fields: [
          {
            key: 'mode',
            label: 'Mode',
            control: 'select',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
          },
          { key: 'enabled', label: 'Enabled', control: 'toggle' },
          { key: 'derived', label: 'Derived', control: 'readonly-derived' },
          { key: 'go', label: 'Go', control: 'action-button', actionId: 'provision' },
        ],
      },
    ])

    const snap = getModuleSectionsSnapshot(buildModuleSectionDescriptors())
    const fabricated = snap.sections.find((s) => s.id === 'fabricated')
    expect(fabricated?.scope).toBe('group')
    expect(fabricated?.actions).toEqual([
      { id: 'provision', label: 'Provision', route: '/api/fabricated/provision', method: 'POST' },
    ])
    expect(fabricated?.fields.find((f) => f.key === 'mode')?.control).toBe('select')
    expect(fabricated?.fields.find((f) => f.key === 'mode')?.options).toEqual([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ])
    expect(fabricated?.fields.find((f) => f.key === 'enabled')?.control).toBe('toggle')
    expect(fabricated?.fields.find((f) => f.key === 'derived')?.control).toBe('readonly-derived')
    const goField = fabricated?.fields.find((f) => f.key === 'go')
    expect(goField?.control).toBe('action-button')
    expect(goField?.actionId).toBe('provision')

    // no visibleWhen leakage: the serialized field/section shapes carry no such key
    expect(fabricated).not.toHaveProperty('visibleWhen')
  })
})
