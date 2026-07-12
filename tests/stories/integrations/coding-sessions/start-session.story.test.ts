// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { updateCodingCredentials } from '../../../../src/coding-credentials/store.js'
import { upsertRepo } from '../../../../src/coding-repos/store.js'
import { contributionRegistry } from '../../../../src/plugins/contributions.js'
import { discoverPlugins } from '../../../../src/plugins/discovery.js'
import { setPluginEnabledForContext } from '../../../../src/plugins/registry.js'
import { kvGet, setPluginAdminConfig } from '../../../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../../../src/plugins/types.js'
import { createFakeMagi } from '../../harness/fake-magi.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability } from '../../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-magi-token'
const PROVIDER_KEY = 'scenario-provider-key'

function discovered(pluginId: string): DiscoveredPlugin {
  const plugin = discoverPlugins('plugins').plugins.find(({ manifest }) => manifest.id === pluginId)
  if (plugin === undefined) throw new Error(`Expected discovered plugin ${pluginId}`)
  return plugin
}

scenario('starts an ACP coding session through the real plugin and tool loop', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
  given.plugin(discovered('acp'))
  setPluginAdminConfig('acp', 'magi_base_url', MAGI_URL, 'scenario-admin')
  setPluginAdminConfig('acp', 'magi_token', MAGI_TOKEN, 'scenario-admin')
  setPluginEnabledForContext('acp', contextId, true)
  updateCodingCredentials(
    contextId,
    'agent-provider',
    { agent: 'claude', provider: 'anthropic', provider_api_key: PROVIDER_KEY },
    alice.id,
  )
  upsertRepo(
    contextId,
    {
      name: 'papai',
      repoUrl: 'https://github.com/acme/papai.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    },
    alice.id,
  )
  const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
  magi.expectStartSession({
    id: 'session-1',
    expected: { contextId, project: 'papai', prompt: 'Add health check', agent: 'claude' },
  })
  given.llm([
    callCapability('coding-session.start', { project: 'papai', prompt: 'Add health check' }),
    answer('Session started: https://papai.invalid/t/share-session-1'),
  ])

  await when.message(alice, dm, 'Add a health check to papai')

  then.replyTo(alice).equals('Session started: https://papai.invalid/t/share-session-1')
  expect(world.runtime.resolveToolCapability('coding-session.start')).toBe('plugin_acp__start_session')
  expect(
    world.model.inspections().some(({ availableTools }) => availableTools.includes('plugin_acp__start_session')),
  ).toBe(true)
  expect(contributionRegistry.getContributions('acp')?.tools.map(({ name }) => name)).toContain('start_session')
  const record = JSON.parse(kvGet('acp', contextId, 'session:session-1') ?? 'null') as unknown
  expect(record).toEqual(
    expect.objectContaining({
      project: 'papai',
      title: 'Add health check',
      shareToken: 'share-session-1',
      transcriptUrl: 'https://papai.invalid/t/share-session-1',
    }),
  )
  const trace = JSON.stringify(world.events.all())
  expect(trace).not.toContain(MAGI_TOKEN)
  expect(trace).not.toContain(PROVIDER_KEY)
  expect(world.events.all().find(({ kind }) => kind === 'magi.session.start')?.data).toEqual(
    expect.objectContaining({
      agent: 'claude-code-acp',
      contextId,
      prompt: 'Add health check',
      environmentNames: ['ANTHROPIC_API_KEY'],
      forgeIncluded: false,
      projectSpec: {
        name: 'papai',
        repoUrl: 'https://github.com/acme/papai.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        agent: 'claude',
        providerHost: 'api.anthropic.com',
      },
    }),
  )
})
