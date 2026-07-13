// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { loadTrustedModules } from '../../../src/composition/load-trusted-modules.js'
import { setCodingGuardrails } from '../../../src/modules/coding/credentials/guardrails.js'
import { codingModule, codingWhoMayUseResolver } from '../../../src/modules/coding/module.js'
import { discoverPlugins } from '../../../src/plugins/discovery.js'
import { activatePlugins, deactivateAllPlugins, getActivatedPluginIds } from '../../../src/plugins/loader.js'
import { operatorAllowlistPort } from '../../../src/ports/operator-allowlist.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('coding module', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(async () => {
    await deactivateAllPlugins()
    await loadTrustedModules([], () => {})
  })

  test('id is "coding"', () => {
    expect(codingModule.id).toBe('coding')
  })

  test('owns the coding-table migrations (061/064/066/067), in ascending order', () => {
    expect(codingModule.migrations?.map((m) => m.id)).toEqual([
      '061_coding_session_credentials',
      '064_coding_session_repos',
      '066_coding_repos_egress',
      '067_acp_tool_prefs_rename',
    ])
  })

  test('codingWhoMayUseResolver returns "members" when no guardrails are set', () => {
    expect(codingWhoMayUseResolver('pi-unset')).toBe('members')
  })

  test('codingWhoMayUseResolver returns the configured allowlist', () => {
    setCodingGuardrails('pi-x', {
      allowedAgents: ['claude'],
      whoMayUse: ['op-1'],
      forceSharedKey: false,
      maxMcpServers: 3,
    })
    expect(codingWhoMayUseResolver('pi-x')).toEqual(['op-1'])
  })

  test('onActivate registers the resolver into the operator-allowlist singleton', () => {
    setCodingGuardrails('pi-y', {
      allowedAgents: ['claude'],
      whoMayUse: ['op-2'],
      forceSharedKey: false,
      maxMcpServers: 3,
    })
    void codingModule.onActivate?.()
    expect(operatorAllowlistPort.resolve('pi-y')).toEqual(['op-2'])
  })

  test('contributes the acp tools, command, fragment, settings section, migration, and eligibility', () => {
    expect(codingModule.tools?.map((t) => t.name)).toContain('start_session')
    expect(codingModule.tools?.length).toBe(9)
    expect(codingModule.commands?.map((c) => c.name)).toEqual(['acp'])
    expect(codingModule.promptFragments?.map((f) => f.name)).toEqual(['acp-hint'])
    expect(codingModule.settingsSections?.map((s) => s.id)).toEqual(['acp'])
    expect(codingModule.migrations?.map((m) => m.id)).toContain('067_acp_tool_prefs_rename')
    expect(typeof codingModule.isEligibleForContext).toBe('function')
  })

  test('publishes a discoverable but non-activatable ACP retirement record', async () => {
    await loadTrustedModules([codingModule], () => {})

    const retiredAcp = discoverPlugins('plugins').plugins.find(({ manifest }) => manifest.id === 'acp')
    expect(retiredAcp).toBeDefined()
    expect(retiredAcp?.retired).toBe(true)

    await activatePlugins([retiredAcp!])
    expect(getActivatedPluginIds()).not.toContain('acp')
  })
})
