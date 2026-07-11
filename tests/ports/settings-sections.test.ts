// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  createSettingsSectionRegistry,
  moduleSettingsRegistry,
  type SettingsSection,
} from '../../src/ports/settings-sections.js'

const section = (id: string): SettingsSection => ({
  id,
  label: id,
  fields: [{ key: 'k', label: 'K' }],
})

describe('moduleSettingsRegistry', () => {
  test('registers and lists sections', () => {
    const reg = createSettingsSectionRegistry()
    reg.register([section('acp'), section('other')])
    expect(reg.list().map((s) => s.id)).toEqual(['acp', 'other'])
  })

  test('clear empties the registry', () => {
    const reg = createSettingsSectionRegistry()
    reg.register([section('acp')])
    reg.clear()
    expect(reg.list()).toEqual([])
  })

  test('exposes a shared singleton', () => {
    expect(typeof moduleSettingsRegistry.list).toBe('function')
  })

  test('registry accepts a rich descriptor with new field kinds + visibleWhen + actions', () => {
    const registry = createSettingsSectionRegistry()
    const richSection: SettingsSection = {
      id: 'demo',
      label: 'Demo',
      scope: 'context',
      visibleWhen: { kind: 'providerCapability', capability: 'members.provision' },
      actions: [{ id: 'provision', label: 'Provision', route: '/ext/demo/provision', method: 'POST' }],
      fields: [
        { key: 'login', label: 'Login', control: 'readonly-derived' },
        { key: 'password', label: 'Password', control: 'reveal-secret', sensitive: true },
        { key: 'provision', label: 'Provision', control: 'action-button', actionId: 'provision' },
      ],
    }
    registry.register([richSection])
    expect(registry.list()).toHaveLength(1)
  })

  test('a minimal descriptor (no new attributes) still registers', () => {
    const registry = createSettingsSectionRegistry()
    registry.register([{ id: 'm', label: 'M', fields: [{ key: 'k', label: 'K' }] }])
    expect(registry.list()[0]?.fields[0]?.control).toBeUndefined()
  })
})
