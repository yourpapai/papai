// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { adminScenarios } from '../../../../client/stories/msw/scenarios-admin.js'
import { scenarios, type ScenarioName } from '../../../../client/stories/msw/scenarios.js'

/**
 * Every scenario key declared by `scenarios.ts` itself (i.e. excluding the keys
 * it re-exports by spreading `adminScenarios`). Storybook addresses scenarios by
 * these exact strings, so a silent rename breaks the stories that request them —
 * pinning the list here makes a rename fail the suite rather than a screenshot.
 */
const LOCAL_SCENARIO_NAMES = [
  'settings-repos-populated',
  'settings-repos-empty',
  'settings-repos-error',
  'settings-repos-loading',
  'settings-byok-secret-set',
  'settings-byok-missing',
  'settings-byok-disabled',
  'settings-byok-error',
  'settings-byok-loading',
  'settings-kaneo-populated',
  'settings-kaneo-not-provisioned',
  'settings-kaneo-error',
  'settings-kaneo-loading',
  'settings-task-provider-bound',
  'settings-shell-ready',
  'settings-shell-group-ready',
  'settings-config-populated',
  'settings-config-empty',
  'settings-config-error',
  'settings-config-loading',
  'settings-coding-credentials-populated',
  'settings-coding-credentials-empty',
  'settings-coding-credentials-error',
  'settings-coding-credentials-loading',
  'settings-coding-credentials-openai-compatible',
  'settings-code-host-populated',
  'settings-code-host-empty',
  'settings-code-host-error',
  'settings-code-host-loading',
  'settings-code-host-save-error',
  'settings-code-host-incomplete',
  'settings-code-host-self-hosted',
  'settings-coding-mcp-populated',
  'settings-coding-mcp-empty',
  'settings-coding-mcp-no-catalog',
  'settings-coding-mcp-error',
  'settings-coding-mcp-loading',
  'settings-coding-mcp-internal-available',
  'settings-coding-mcp-internal-selected',
  'settings-memory-populated',
  'settings-memory-empty',
  'settings-memory-error',
  'settings-memory-loading',
  'settings-memory-empty-capture-on',
  'settings-memory-provisional',
  'settings-mcp-populated',
  'settings-mcp-empty',
  'settings-mcp-error',
  'settings-mcp-loading',
  'settings-plugins-populated',
  'settings-plugins-empty',
  'settings-plugins-error',
  'settings-plugins-loading',
  'settings-plugins-configurable',
  'settings-plugins-ineligible',
  'settings-identity-populated',
  'settings-identity-empty',
  'settings-identity-error',
  'settings-identity-loading',
  'settings-identity-gated',
  'settings-release-populated',
  'settings-release-empty',
  'settings-release-error',
  'settings-release-loading',
  'settings-release-mutating',
  'settings-release-mutation-error',
  'settings-members-populated',
  'settings-members-empty',
  'settings-members-error',
  'settings-members-loading',
  'settings-guest-mode-populated',
  'settings-guest-mode-empty',
  'settings-guest-mode-error',
  'settings-guest-mode-loading',
  'settings-group-provider-populated',
  'settings-group-provider-empty',
  'settings-group-provider-error',
  'settings-group-provider-loading',
  'settings-group-provider-unassigned',
  'settings-group-provider-nameless-bound',
  'settings-coding-identity-populated',
  'settings-coding-identity-empty',
  'settings-coding-identity-error',
  'settings-coding-identity-loading',
  'settings-analytics-populated',
  'settings-analytics-empty',
  'settings-analytics-error',
  'settings-analytics-loading',
  'settings-analytics-withdrawal-in-progress',
  'settings-analytics-rights-unavailable',
  'settings-analytics-legitimate-interest-unset',
] as const satisfies readonly ScenarioName[]

describe('msw scenarios', () => {
  test('the registry declares exactly its own names plus the admin ones it re-exports', () => {
    const expected = [...Object.keys(adminScenarios), ...LOCAL_SCENARIO_NAMES].toSorted()
    expect(Object.keys(scenarios).toSorted()).toEqual(expected)
  })

  test.each<ScenarioName>([...LOCAL_SCENARIO_NAMES])('%s resolves to a non-empty handler bundle', (name) => {
    expect(scenarios[name].length).toBeGreaterThan(0)
  })

  test('settings-shell-group-ready layers the group families onto the shell bundle', () => {
    expect(scenarios['settings-shell-group-ready'].length).toBeGreaterThan(scenarios['settings-shell-ready'].length)
  })

  test('admin scenarios stay reachable through the composed registry', () => {
    expect(scenarios['admin-populated']).toEqual(adminScenarios['admin-populated'])
  })
})
