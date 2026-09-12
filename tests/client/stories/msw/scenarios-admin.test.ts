// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { adminScenarios } from '../../../../client/stories/msw/scenarios-admin.js'

type AdminScenarioName = keyof typeof adminScenarios

/**
 * Every scenario key the admin registry declares. Storybook addresses scenarios
 * by these exact strings, so a silent rename breaks the stories that request
 * them — pinning the list here makes a rename fail the suite, not a screenshot.
 */
const ADMIN_SCENARIO_NAMES = [
  'admin-populated',
  'admin-empty',
  'admin-error',
  'billing-populated',
  'billing-empty',
  'billing-error',
  'billing-loading',
  'stats-populated',
  'stats-empty',
  'stats-error',
  'plugin-config-populated',
  'plugin-config-empty',
  'plugin-config-error',
  'instances-populated',
  'instances-empty',
  'instances-error',
  'settings-admin-users-populated',
  'settings-admin-users-empty',
  'settings-admin-users-error',
  'settings-admin-users-loading',
  'settings-admin-users-open-access-error',
  'settings-admin-byok-populated',
  'settings-admin-byok-empty',
  'settings-admin-byok-error',
  'settings-admin-byok-loading',
  'settings-admin-providers-populated',
  'settings-admin-providers-empty',
  'settings-admin-providers-error',
  'settings-admin-providers-loading',
  'settings-admin-llm-roles-populated',
  'settings-admin-llm-roles-empty',
  'settings-admin-llm-roles-error',
  'settings-admin-llm-roles-loading',
  'settings-admin-groups-populated',
  'settings-admin-groups-empty',
  'settings-admin-groups-error',
  'settings-admin-groups-loading',
  'settings-admin-admins-populated',
  'settings-admin-admins-empty',
  'settings-admin-admins-error',
  'settings-admin-admins-loading',
  'settings-admin-plugin-config-populated',
  'settings-admin-plugin-config-empty',
  'settings-admin-plugin-config-error',
  'settings-admin-plugin-config-loading',
  'settings-admin-tool-defaults-populated',
  'settings-admin-tool-defaults-empty',
  'settings-admin-tool-defaults-error',
  'settings-admin-tool-defaults-loading',
  'settings-admin-release-notes-populated',
  'settings-admin-release-notes-empty',
  'settings-admin-release-notes-error',
  'settings-admin-release-notes-loading',
  'settings-admin-coding-guardrails-populated',
  'settings-admin-coding-guardrails-empty',
  'settings-admin-coding-guardrails-error',
  'settings-admin-coding-guardrails-loading',
  'settings-admin-mcp-catalog-populated',
  'settings-admin-mcp-catalog-empty',
  'settings-admin-mcp-catalog-error',
  'settings-admin-mcp-catalog-loading',
  'settings-admin-mcp-plugin-servers-populated',
  'settings-admin-mcp-plugin-servers-empty',
  'settings-admin-mcp-plugin-servers-error',
  'settings-admin-mcp-plugin-servers-loading',
  'settings-admin-instances-populated',
  'settings-admin-instances-empty',
  'settings-admin-instances-error',
  'settings-admin-instances-loading',
  'settings-shell-admin-ready',
  'settings-admin-analytics-populated',
  'settings-admin-analytics-empty',
  'settings-admin-analytics-error',
  'settings-admin-analytics-loading',
  'settings-admin-analytics-incomplete-governance',
  'settings-admin-analytics-governed-local-pilot',
  'settings-admin-analytics-kill-switch',
  'settings-admin-analytics-failed-sink',
  'settings-admin-analytics-reconciled-healthy',
] as const satisfies readonly AdminScenarioName[]

describe('msw admin scenarios', () => {
  test('the registry declares exactly the expected scenario names', () => {
    expect(Object.keys(adminScenarios).toSorted()).toEqual([...ADMIN_SCENARIO_NAMES].toSorted())
  })

  test.each<AdminScenarioName>([...ADMIN_SCENARIO_NAMES])('%s resolves to a non-empty handler bundle', (name) => {
    expect(adminScenarios[name].length).toBeGreaterThan(0)
  })

  test('admin-populated composes billing, stats, pluginConfig, instances, and identityMappings families', () => {
    // billing (2) + stats (2) + pluginConfig (2) + instances (8) + identityMappings (1) populated handlers
    // admin handlers are now empty (System / LLM section removed)
    expect(adminScenarios['admin-populated'].length).toBe(15)
  })

  test('release-notes populated scenario carries per-locale bodies, not a single body', async () => {
    const { adminReleaseNotesHandlers, adminReleaseNotesPopulatedFixture } =
      await import('../../../../client/stories/msw/settings-handlers-admin-2.js')
    const handler = adminReleaseNotesHandlers.populated[0]
    expect(handler).toBeDefined()
    expect(handler?.info.path).toBe('/settings/api/admin/release-notes')
    expect(typeof adminReleaseNotesPopulatedFixture.bodies.en).toBe('string')
    expect(typeof adminReleaseNotesPopulatedFixture.bodies.ru).toBe('string')
    expect((adminReleaseNotesPopulatedFixture as Record<string, unknown>)['body']).toBeUndefined()
  })
})
