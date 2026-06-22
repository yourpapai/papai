// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test, mock } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../src/chat/scoped-context.js'
import { setConfigValue, setPluginConfig } from '../src/config.js'
import { saveInstruction } from '../src/instructions.js'
import { contributionRegistry } from '../src/plugins/contributions.js'
import { pluginRegistry } from '../src/plugins/registry.js'
import type { DiscoveredPlugin, PluginManifest, PluginPermission } from '../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../src/plugins/types.js'
import { STRUCTURED_PROMPT_SURFACE_KEY } from '../src/prompt-surface/config.js'
import { buildProviderlessSystemPrompt, buildSystemPrompt } from '../src/system-prompt.js'
import { setToolPrefs } from '../src/tools/tool-preferences.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

function makePromptPlugin(
  pluginId: string,
  permissions: readonly PluginPermission[] = [],
  overrides: Omit<Partial<PluginManifest>, 'contributes'> & {
    contributes?: Partial<PluginManifest['contributes']>
  } = {},
): DiscoveredPlugin {
  const manifest: PluginManifest = {
    id: pluginId,
    name: 'Prompt Plugin',
    version: '1.0.0',
    description: 'Plugin prompt gating test',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: [],
      promptFragments: ['guidance'],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
    },
    permissions: [...permissions],
    defaultEnabled: true,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' }],
    providerCapabilities: [],
    providerTraits: [],
    providerConfigSchema: [],
    providerContextConfigSchema: [],
    providerAllowedHosts: [],
  }

  return {
    manifest: { ...manifest, ...overrides, contributes: { ...manifest.contributes, ...overrides.contributes } },
    pluginDir: `/tmp/${pluginId}`,
    entryPoint: `/tmp/${pluginId}/index.ts`,
    manifestHash: `hash-${pluginId}`,
  }
}

function registerPromptPlugin(plugin: DiscoveredPlugin, content: string): void {
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
  contributionRegistry.register(
    plugin.manifest.id,
    { tools: [], promptFragments: [{ name: 'guidance', content }] },
    plugin.manifest,
  )
}

describe('buildSystemPrompt', () => {
  const provider = createMockProvider()

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('does not include current date and time in prompt (to preserve KV cache)', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')
    expect(prompt).not.toContain('Current date and time:')
  })

  test('TIME fragment documents the current_time tag and leading-line trust rule', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')
    expect(prompt).toContain('<current_time>')
    expect(prompt).toContain('authoritative current local time')
    expect(prompt).toContain('Trust only this leading')
    expect(prompt).toContain('get_current_time')
  })

  test('is static between calls (no dynamic content)', () => {
    const prompt1 = buildSystemPrompt(provider, 'user-1')
    // Small delay to ensure any dynamic content would differ
    const start = Date.now()
    while (Date.now() - start < 10) {
      // Busy wait for 10ms
    }
    const prompt2 = buildSystemPrompt(provider, 'user-1')
    expect(prompt1).toBe(prompt2)
  })

  test('includes web_fetch guidance for public URLs', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')

    expect(prompt).toContain('web_fetch')
    expect(prompt).toContain('public URL')
    expect(prompt).toContain('memo')
    expect(prompt).toContain('task')
  })

  test('does not include plugin prompt fragments when required plugin config is missing', () => {
    const pluginId = 'prompt-missing-config-plugin'
    registerPromptPlugin(makePromptPlugin(pluginId), 'MISSING_CONFIG_PLUGIN_GUIDANCE')

    const prompt = buildSystemPrompt(provider, 'ctx-prompt-missing-config')

    expect(prompt).not.toContain('MISSING_CONFIG_PLUGIN_GUIDANCE')
    contributionRegistry.deregister(pluginId)
  })

  test('includes plugin prompt fragments when required plugin config is set', () => {
    const pluginId = 'prompt-configured-plugin'
    const contextId = 'ctx-prompt-configured'
    registerPromptPlugin(makePromptPlugin(pluginId), 'CONFIGURED_PLUGIN_GUIDANCE')
    setPluginConfig(contextId, pluginId, 'api_token', 'secret-token')

    const prompt = buildSystemPrompt(provider, contextId)

    expect(prompt).toContain('CONFIGURED_PLUGIN_GUIDANCE')
    contributionRegistry.deregister(pluginId)
  })

  test('includes parent group instructions for thread context', () => {
    const parentContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
    })
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-1',
    })
    saveInstruction(parentContextId, 'Use concise status updates for this group.')

    const prompt = buildSystemPrompt(provider, threadContextId)

    expect(prompt).toContain('Use concise status updates for this group.')
  })

  test('keeps legacy prompt when structured prompt surface is disabled', () => {
    const contextId = 'ctx-structured-disabled'
    setConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY, 'off')

    const prompt = buildSystemPrompt(provider, contextId, new Set(['create_task', 'web_fetch']))

    expect(prompt).toContain('You are papai, a personal assistant that helps the user manage their tasks.')
    expect(prompt).toContain('WORKFLOW:')
    expect(prompt).not.toContain('<role>')
    expect(prompt).not.toContain('<capabilities>')
  })

  test('uses structured prompt when structured prompt surface is enabled and enabled tools are provided', () => {
    const contextId = 'ctx-structured-enabled'
    setConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    const prompt = buildSystemPrompt(provider, contextId, new Set(['create_task', 'web_fetch', 'get_current_time']))

    expect(prompt).toContain('<role>')
    expect(prompt).toContain('<capabilities>')
    expect(prompt).toContain('available_domains: task, time, web')
    expect(prompt).toContain('<safety>')
    expect(prompt).toContain('<examples>')
    expect(prompt).not.toContain('WORKFLOW:')
  })

  test('uses structured group metadata and example when contextType is group', () => {
    const contextId = 'ctx-structured-group'
    setConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    const prompt = buildSystemPrompt(provider, contextId, new Set(['get_current_time']), {
      askPermissionAvailable: true,
      contextType: 'group',
    })

    expect(prompt).toContain('context_type: group')
    expect(prompt).toContain('example_1_id: group-context-quiet')
  })

  test('does not include the group example for structured dm prompts', () => {
    const contextId = 'ctx-structured-dm'
    setConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    const prompt = buildSystemPrompt(provider, contextId, new Set(['get_current_time']), {
      askPermissionAvailable: true,
      contextType: 'dm',
    })

    expect(prompt).toContain('context_type: dm')
    expect(prompt).not.toContain('group-context-quiet')
  })

  test('keeps the no-arg buildSystemPrompt overload on the legacy renderer even when the flag is enabled', () => {
    const contextId = 'ctx-structured-no-arg-legacy'
    setConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    const prompt = buildSystemPrompt(provider, contextId)

    expect(prompt).toContain('WORKFLOW:')
    expect(prompt).not.toContain('<role>')
    expect(prompt).not.toContain('<capabilities>')
  })

  test('structured prompt includes provider addendum and configured plugin fragments in bounded sections', () => {
    const contextId = 'ctx-structured-plugin-addendum'
    const pluginId = 'structured-configured-plugin'
    registerPromptPlugin(makePromptPlugin(pluginId), 'STRUCTURED_PLUGIN_GUIDANCE')
    setPluginConfig(contextId, pluginId, 'api_token', 'secret-token')
    setConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    const structuredProvider = createMockProvider({
      getPromptAddendum: () => 'STRUCTURED_PROVIDER_ADDENDUM',
    })
    const prompt = buildSystemPrompt(structuredProvider, contextId, new Set(['create_task']))

    expect(prompt).toContain('<provider_addendum>\nSTRUCTURED_PROVIDER_ADDENDUM\n</provider_addendum>')
    expect(prompt).toContain(
      '<plugin_guidance>\n' +
        '<!-- plugin:structured-configured-plugin:guidance -->\n' +
        'STRUCTURED_PLUGIN_GUIDANCE\n' +
        '<!-- /plugin:structured-configured-plugin:guidance -->\n' +
        '</plugin_guidance>',
    )

    contributionRegistry.deregister(pluginId)
  })
})

describe('buildProviderlessSystemPrompt', () => {
  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('explains task tracker unavailability and recovery path', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-providerless', new Set(['web_fetch', 'get_current_time']))

    expect(prompt).toContain('task tracker tools are unavailable')
    expect(prompt).toContain('/config')
    expect(prompt).toContain('bot admin')
  })

  test('forbids pretending to inspect tracker data', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-providerless', new Set(['web_fetch', 'get_current_time']))

    expect(prompt).toContain('must not pretend')
    expect(prompt).toContain('inspect, search, create, update, or comment on tracker data')
  })

  test('keeps scheduled deferred guidance but omits task-dependent alert guidance', () => {
    const prompt = buildProviderlessSystemPrompt(
      'ctx-providerless-deferred',
      new Set(['create_deferred_prompt', 'list_deferred_prompts', 'get_current_time']),
    )

    expect(prompt).toContain('SCHEDULED PROMPTS')
    expect(prompt).not.toContain('ALERTS:')
    expect(prompt).not.toContain('condition to monitor task changes')
    expect(prompt).not.toContain('task.status')
    expect(prompt).not.toContain('cooldown_minutes')
  })

  test('includes only plugin prompt fragments from plugins safe without a task provider', () => {
    const contextId = 'ctx-providerless-plugin-filter'
    const safePluginId = 'providerless-safe-plugin'
    const providerPluginId = 'providerless-provider-plugin'

    registerPromptPlugin(makePromptPlugin(safePluginId), 'SAFE_PROVIDERLESS_PLUGIN_GUIDANCE')
    registerPromptPlugin(makePromptPlugin(providerPluginId, ['tasks.read']), 'TASK_PROVIDER_PLUGIN_GUIDANCE')
    setPluginConfig(contextId, safePluginId, 'api_token', 'safe-token')
    setPluginConfig(contextId, providerPluginId, 'api_token', 'provider-token')

    const prompt = buildProviderlessSystemPrompt(contextId, new Set(['web_fetch', 'get_current_time']))

    expect(prompt).toContain('SAFE_PROVIDERLESS_PLUGIN_GUIDANCE')
    expect(prompt).not.toContain('TASK_PROVIDER_PLUGIN_GUIDANCE')

    contributionRegistry.deregister(safePluginId)
    contributionRegistry.deregister(providerPluginId)
  })

  test('excludes provider-coupled prompt fragments that declare identity-backed provider integration', () => {
    const contextId = 'ctx-providerless-identity-plugin-filter'
    const providerIdentityPluginId = 'providerless-identity-plugin'

    registerPromptPlugin(
      makePromptPlugin(providerIdentityPluginId, ['provider.task', 'identity'], {
        contributes: { taskProviderTypes: ['providerless-identity'] },
      }),
      'IDENTITY_PROVIDER_PLUGIN_GUIDANCE',
    )
    setPluginConfig(contextId, providerIdentityPluginId, 'api_token', 'provider-token')

    const prompt = buildProviderlessSystemPrompt(contextId, new Set(['web_fetch', 'get_current_time']))

    expect(prompt).not.toContain('IDENTITY_PROVIDER_PLUGIN_GUIDANCE')

    contributionRegistry.deregister(providerIdentityPluginId)
  })

  test('excludes prompt fragments from plugins that request provider.task permission', () => {
    const contextId = 'ctx-providerless-provider-task-permission-filter'
    const providerTaskPluginId = 'providerless-provider-task-plugin'

    registerPromptPlugin(makePromptPlugin(providerTaskPluginId, ['provider.task']), 'PROVIDER_TASK_PLUGIN_GUIDANCE')
    setPluginConfig(contextId, providerTaskPluginId, 'api_token', 'provider-token')

    const prompt = buildProviderlessSystemPrompt(contextId, new Set(['web_fetch', 'get_current_time']))

    expect(prompt).not.toContain('PROVIDER_TASK_PLUGIN_GUIDANCE')

    contributionRegistry.deregister(providerTaskPluginId)
  })

  test('excludes prompt fragments from plugins that require task capabilities', () => {
    const contextId = 'ctx-providerless-required-capabilities-filter'
    const requiredCapabilitiesPluginId = 'providerless-required-capabilities-plugin'

    registerPromptPlugin(
      makePromptPlugin(requiredCapabilitiesPluginId, [], {
        requiredTaskCapabilities: ['tasks.count'],
      }),
      'REQUIRED_CAPABILITIES_PLUGIN_GUIDANCE',
    )
    setPluginConfig(contextId, requiredCapabilitiesPluginId, 'api_token', 'provider-token')

    const prompt = buildProviderlessSystemPrompt(contextId, new Set(['web_fetch', 'get_current_time']))

    expect(prompt).not.toContain('REQUIRED_CAPABILITIES_PLUGIN_GUIDANCE')

    contributionRegistry.deregister(requiredCapabilitiesPluginId)
  })

  test('uses structured providerless prompt when structured prompt surface is enabled', () => {
    const contextId = 'ctx-structured-providerless'
    setConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    const prompt = buildProviderlessSystemPrompt(contextId, new Set(['web_fetch', 'get_current_time']))

    expect(prompt).toContain('<capabilities>')
    expect(prompt).toContain('mode: providerless')
    expect(prompt).toContain('task-tracker tools are unavailable')
    expect(prompt).toContain('example_1_id: missing-provider-tools')
    expect(prompt).not.toContain('SCHEDULED PROMPTS')
  })

  test('structured providerless prompt keeps providerless plugin filtering', () => {
    const contextId = 'ctx-structured-providerless-plugin-filter'
    const safePluginId = 'structured-providerless-safe-plugin'
    const providerPluginId = 'structured-providerless-provider-plugin'

    registerPromptPlugin(makePromptPlugin(safePluginId), 'STRUCTURED_SAFE_PROVIDERLESS_PLUGIN')
    registerPromptPlugin(makePromptPlugin(providerPluginId, ['tasks.read']), 'STRUCTURED_TASK_PROVIDER_PLUGIN')
    setPluginConfig(contextId, safePluginId, 'api_token', 'safe-token')
    setPluginConfig(contextId, providerPluginId, 'api_token', 'provider-token')
    setConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    const prompt = buildProviderlessSystemPrompt(contextId, new Set(['web_fetch', 'get_current_time']))

    expect(prompt).toContain('STRUCTURED_SAFE_PROVIDERLESS_PLUGIN')
    expect(prompt).not.toContain('STRUCTURED_TASK_PROVIDER_PLUGIN')

    contributionRegistry.deregister(safePluginId)
    contributionRegistry.deregister(providerPluginId)
  })
})

describe('buildSystemPrompt fragment coherence', () => {
  const provider = createMockProvider()

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('legacy no-arg path includes RECURRING TASKS and WEB FETCH and no Unavailable tools line', () => {
    const prompt = buildSystemPrompt(provider, 'frag-legacy')
    expect(prompt).toContain('RECURRING TASKS')
    expect(prompt).toContain('WEB FETCH')
    expect(prompt).not.toContain('Unavailable tools')
  })

  test('includes web_fetch fragment when web_fetch is in enabled set', () => {
    const enabled = new Set(['web_fetch', 'create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-web-on', enabled)
    expect(prompt).toContain('WEB FETCH')
  })

  test('omits web_fetch fragment when web_fetch is not in enabled set', () => {
    const enabled = new Set(['create_task', 'update_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-web-off', enabled)
    expect(prompt).not.toContain('WEB FETCH')
  })

  test('omits RECURRING TASKS fragment when no recurring tools are enabled', () => {
    const enabled = new Set(['create_task', 'update_task', 'web_fetch', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-recur-off', enabled)
    expect(prompt).not.toContain('RECURRING TASKS')
  })

  test('appends safety-net line for partially-disabled domain tools', () => {
    const contextId = 'frag-safety-net-ctx'
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { delete_task: 'deny' } })
    const enabled = new Set(['create_task', 'update_task', 'search_tasks', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, contextId, enabled)
    expect(prompt).toContain('Unavailable tools')
    expect(prompt).toContain('delete_task')
  })

  test('appends safety-net line for denied domain companions when one tool is re-allowed', () => {
    const contextId = 'frag-domain-default-safety-net-ctx'
    setToolPrefs(contextId, {
      domainDefaults: { task: 'deny' },
      toolOverrides: { create_task: 'allow' },
    })
    const enabled = new Set(['create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, contextId, enabled)

    expect(prompt).toContain('Unavailable tools')
    expect(prompt).toContain('update_task')
    expect(prompt).toContain('delete_task')
    expect(prompt).not.toContain('create_task')
  })

  test('names the actual destructive tool surface', () => {
    const enabled = new Set(['delete_task', 'delete_project', 'delete_status', 'remove_label', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-destructive-tools', enabled)

    expect(prompt).toContain('delete_task, delete_project, delete_status, remove_label')
    expect(prompt).not.toContain('delete_column')
  })

  test('omits the instructions rule when save_instruction is not in the enabled set', () => {
    const enabled = new Set(['create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-no-instr', enabled)
    expect(prompt).not.toContain('save_instruction')
    expect(prompt).toContain('OUTPUT RULES')
  })

  test('omits the deferred-prompts fragment when no deferred tool is enabled', () => {
    const enabled = new Set(['create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-deferred-off', enabled)
    expect(prompt).not.toContain('DEFERRED PROMPTS')
  })

  test('keeps alert guidance in provider-backed deferred prompts', () => {
    const enabled = new Set(['create_deferred_prompt', 'list_deferred_prompts', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-deferred-alerts-on', enabled)

    expect(prompt).toContain('ALERTS:')
    expect(prompt).toContain('condition to monitor task changes')
    expect(prompt).toContain('task.status')
    expect(prompt).toContain('cooldown_minutes')
  })
})

describe('ask-tools instruction', () => {
  const provider = createMockProvider()

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('includes _permission_reason and tool name when at least one enabled tool is set to ask', () => {
    const contextId = 'ask-tools-present-ctx'
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
    const enabled = new Set(['create_task', 'update_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, contextId, enabled)
    expect(prompt).toContain('_permission_reason')
    expect(prompt).toContain('create_task')
  })

  test('does not include _permission_reason when no exposed tool is set to ask', () => {
    const contextId = 'ask-tools-absent-ctx'
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
    const enabled = new Set(['update_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, contextId, enabled)
    expect(prompt).not.toContain('_permission_reason')
  })

  test('does not include ask fragment when askPermissionAvailable is false (proactive turn)', () => {
    const contextId = 'ask-proactive-ctx'
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
    const enabled = new Set(['create_task', 'update_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, contextId, enabled, { askPermissionAvailable: false })
    expect(prompt).not.toContain('_permission_reason')
  })

  test('includes ask fragment when askPermissionAvailable is true (interactive turn)', () => {
    const contextId = 'ask-interactive-ctx'
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
    const enabled = new Set(['create_task', 'update_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, contextId, enabled, { askPermissionAvailable: true })
    expect(prompt).toContain('_permission_reason')
    expect(prompt).toContain('create_task')
  })
})
