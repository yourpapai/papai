// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { discoverPlugins } from '../../../src/plugins/discovery.js'
import type { DiscoveredPlugin } from '../../../src/plugins/types.js'
import { scenario } from '../harness/scenario.js'

const BYOK_SECRET = 'scenario-byok-secret-1234'
const MCP_SECRET = 'Bearer scenario-mcp-secret-9876'
const PLUGIN_SECRET = 'scenario-plugin-secret-2468'
const AUDIO_PLUGIN_ID = 'audio-transcribe'

const ToolsResponseSchema = z.object({ domains: z.array(z.object({ domain: z.string(), summary: z.string() })) })
const ByokStateSchema = z.object({ enabled: z.boolean(), complete: z.boolean() })
const PluginsResponseSchema = z.object({
  plugins: z.array(
    z.object({ id: z.string(), contextConfig: z.array(z.object({ key: z.string(), hasValue: z.boolean() })) }),
  ),
})
const McpResponseSchema = z.object({
  endpoints: z.array(z.object({ headers: z.record(z.string(), z.string()).optional() })),
})

function discoveredPlugin(id: string): DiscoveredPlugin {
  const plugin = discoverPlugins('plugins').plugins.find(({ manifest }) => manifest.id === id)
  if (plugin === undefined) throw new Error(`Expected discovered plugin ${id}`)
  return plugin
}

scenario(
  'SCN-settings-api-tools: tool permissions reject untrusted writes and round-trip a domain setting',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const session = await given.settingsSession(alice)
    const body = JSON.stringify({ kind: 'domain', domain: 'time', permission: 'deny' })

    const anonymous = await when.request('/settings/api/tools')
    then.responseStatus(anonymous, 401)

    const before = await when.settingsRequest(session, '/settings/api/tools')
    then.responseStatus(before, 200)
    const beforeValue = z.unknown().parse(await before.json())

    const csrfRejected = await when.settingsRequest(
      session,
      '/settings/api/tools/toggle',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const afterRejected = await when.settingsRequest(session, '/settings/api/tools')
    then.responseStatus(afterRejected, 200)
    expect(await afterRejected.json()).toEqual(beforeValue)

    const updated = await when.settingsRequest(session, '/settings/api/tools/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(updated, 200)

    const observed = await when.settingsRequest(session, '/settings/api/tools')
    then.responseStatus(observed, 200)
    const domains = ToolsResponseSchema.parse(await observed.json()).domains
    expect(domains.find((domain) => domain.domain === 'time')?.summary).toBe('deny')
  },
)

scenario(
  'SCN-settings-api-byok: BYOK writes stay in the caller context and never disclose the submitted secret',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const aliceDm = given.dm(alice)
    const bobDm = given.dm(bob)
    const session = await given.settingsSession(alice)
    const bobSession = await when.settingsSession(bob)
    const bobContextId = world.scopedStorageContextId(bobDm)

    const bobBefore = await when.settingsRequest(bobSession, '/settings/api/byok')
    then.responseStatus(bobBefore, 200)
    const bobBeforeValue = z.unknown().parse(await bobBefore.json())

    const crossContext = await when.settingsRequest(session, '/settings/api/byok', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextId: bobContextId, action: 'enable' }),
    })
    then.responseStatus(crossContext, 403)

    const bobAfterRejected = await when.settingsRequest(bobSession, '/settings/api/byok')
    then.responseStatus(bobAfterRejected, 200)
    expect(await bobAfterRejected.json()).toEqual(bobBeforeValue)

    const enabled = await when.settingsRequest(session, '/settings/api/byok', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enable' }),
    })
    then.responseStatus(enabled, 200)

    const saved = await when.settingsRequest(session, '/settings/api/byok', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: {
          llm_apikey: BYOK_SECRET,
          llm_baseurl: 'https://api.example.invalid/v1',
          main_model: 'gpt-settings-story',
        },
      }),
    })
    then.responseStatus(saved, 200)
    expect(JSON.stringify(await saved.json())).not.toContain(BYOK_SECRET)

    const observed = await when.settingsRequest(session, '/settings/api/byok')
    then.responseStatus(observed, 200)
    const state = ByokStateSchema.parse(await observed.clone().json())
    const responseText = await observed.text()
    expect(responseText).not.toContain(BYOK_SECRET)
    expect(state).toMatchObject({ enabled: true, complete: true })
    expect(JSON.stringify(world.events.all())).not.toContain(BYOK_SECRET)
    expect(world.scopedStorageContextId(aliceDm)).not.toBe(bobContextId)
  },
)

scenario(
  'SCN-settings-api-memory: invalid memory updates leave the view unchanged and valid capture writes persist',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const session = await given.settingsSession(alice)

    const before = await when.settingsRequest(session, '/settings/api/memory')
    then.responseStatus(before, 200)
    const beforeValue = z.unknown().parse(await before.json())

    const invalid = await when.settingsRequest(session, '/settings/api/memory/capture', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'false' }),
    })
    then.responseStatus(invalid, 422)

    const afterRejected = await when.settingsRequest(session, '/settings/api/memory')
    then.responseStatus(afterRejected, 200)
    expect(await afterRejected.json()).toEqual(beforeValue)

    const updated = await when.settingsRequest(session, '/settings/api/memory/capture', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    then.responseStatus(updated, 200)

    const observed = await when.settingsRequest(session, '/settings/api/memory')
    then.responseStatus(observed, 200)
    expect(await observed.json()).toMatchObject({ enabled: false })
  },
)

scenario(
  'SCN-settings-api-plugins: plugin config rejects unknown keys and masks a persisted context secret',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    given.plugin(discoveredPlugin(AUDIO_PLUGIN_ID))
    const session = await given.settingsSession(alice)

    const before = await when.settingsRequest(session, '/settings/api/plugins')
    then.responseStatus(before, 200)
    const beforeValue = z.unknown().parse(await before.json())

    const invalid = await when.settingsRequest(session, '/settings/api/plugins/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: AUDIO_PLUGIN_ID, key: 'not-a-real-key', value: 'ignored' }),
    })
    then.responseStatus(invalid, 422)

    const afterRejected = await when.settingsRequest(session, '/settings/api/plugins')
    then.responseStatus(afterRejected, 200)
    expect(await afterRejected.json()).toEqual(beforeValue)

    const saved = await when.settingsRequest(session, '/settings/api/plugins/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: AUDIO_PLUGIN_ID, key: 'api_key', value: PLUGIN_SECRET }),
    })
    then.responseStatus(saved, 200)
    expect(JSON.stringify(await saved.json())).not.toContain(PLUGIN_SECRET)

    const observed = await when.settingsRequest(session, '/settings/api/plugins')
    then.responseStatus(observed, 200)
    const plugins = PluginsResponseSchema.parse(await observed.clone().json())
    const responseText = await observed.text()
    expect(responseText).not.toContain(PLUGIN_SECRET)
    const audio = plugins.plugins.find(({ id }) => id === AUDIO_PLUGIN_ID)
    expect(audio?.contextConfig.find(({ key }) => key === 'api_key')?.hasValue).toBe(true)
    expect(JSON.stringify(world.events.all())).not.toContain(PLUGIN_SECRET)
  },
)

scenario(
  'SCN-settings-api-mcp: endpoint validation preserves prior state and masks persisted authorization headers',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const session = await given.settingsSession(alice)

    const before = await when.settingsRequest(session, '/settings/api/mcp')
    then.responseStatus(before, 200)
    const beforeValue = z.unknown().parse(await before.json())

    const invalid = await when.settingsRequest(session, '/settings/api/mcp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoints: [{ id: 'insecure', url: 'http://mcp.example.invalid', enabled: true }] }),
    })
    then.responseStatus(invalid, 422)

    const afterRejected = await when.settingsRequest(session, '/settings/api/mcp')
    then.responseStatus(afterRejected, 200)
    expect(await afterRejected.json()).toEqual(beforeValue)

    const saved = await when.settingsRequest(session, '/settings/api/mcp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoints: [
          {
            id: 'scenario-mcp',
            url: 'https://mcp.example.invalid',
            enabled: true,
            headers: { Authorization: MCP_SECRET },
          },
        ],
      }),
    })
    then.responseStatus(saved, 200)
    expect(JSON.stringify(await saved.json())).not.toContain(MCP_SECRET)

    const observed = await when.settingsRequest(session, '/settings/api/mcp')
    then.responseStatus(observed, 200)
    const endpoints = McpResponseSchema.parse(await observed.clone().json()).endpoints
    const responseText = await observed.text()
    expect(responseText).not.toContain(MCP_SECRET)
    expect(endpoints[0]?.headers?.['Authorization']).toBe('****9876')
    expect(JSON.stringify(world.events.all())).not.toContain(MCP_SECRET)
  },
)

scenario(
  'SCN-settings-api-group: only a group administrator can update the group guest-mode setting',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const group = given.group('settings-group')
    given.member(group, alice)
    given.member(group, bob)
    given.groupAdmin(group, alice)
    await when.message(alice, group, '/config')
    const aliceSession = await when.settingsSession(alice)
    const bobSession = await when.settingsSession(bob)
    const contextId = world.scopedStorageContextId(group)
    const body = JSON.stringify({ contextId, enabled: true })

    const before = await when.settingsRequest(
      aliceSession,
      `/settings/api/group/guest-mode?contextId=${encodeURIComponent(contextId)}`,
    )
    then.responseStatus(before, 200)
    const beforeValue = z.unknown().parse(await before.json())

    const rejected = await when.settingsRequest(bobSession, '/settings/api/group/guest-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(rejected, 403)

    const afterRejected = await when.settingsRequest(
      aliceSession,
      `/settings/api/group/guest-mode?contextId=${encodeURIComponent(contextId)}`,
    )
    then.responseStatus(afterRejected, 200)
    expect(await afterRejected.json()).toEqual(beforeValue)

    const updated = await when.settingsRequest(aliceSession, '/settings/api/group/guest-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(updated, 200)

    const observed = await when.settingsRequest(
      aliceSession,
      `/settings/api/group/guest-mode?contextId=${encodeURIComponent(contextId)}`,
    )
    then.responseStatus(observed, 200)
    expect(await observed.json()).toMatchObject({ contextId, enabled: true })
  },
)

scenario(
  'SCN-settings-api-release: only a group administrator can change a group release subscription',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const group = given.group('release-group')
    given.member(group, alice)
    given.member(group, bob)
    given.groupAdmin(group, alice)
    await when.message(alice, group, '/config')
    const aliceSession = await when.settingsSession(alice)
    const bobSession = await when.settingsSession(bob)
    const contextId = world.scopedStorageContextId(group)
    const body = JSON.stringify({ contextId, enabled: true })

    const before = await when.settingsRequest(
      aliceSession,
      `/settings/api/group/release-subscription?contextId=${encodeURIComponent(contextId)}`,
    )
    then.responseStatus(before, 200)
    const beforeValue = z.unknown().parse(await before.json())

    const rejected = await when.settingsRequest(bobSession, '/settings/api/group/release-subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(rejected, 403)

    const afterRejected = await when.settingsRequest(
      aliceSession,
      `/settings/api/group/release-subscription?contextId=${encodeURIComponent(contextId)}`,
    )
    then.responseStatus(afterRejected, 200)
    expect(await afterRejected.json()).toEqual(beforeValue)

    const updated = await when.settingsRequest(aliceSession, '/settings/api/group/release-subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(updated, 200)

    const observed = await when.settingsRequest(
      aliceSession,
      `/settings/api/group/release-subscription?contextId=${encodeURIComponent(contextId)}`,
    )
    then.responseStatus(observed, 200)
    expect(await observed.json()).toMatchObject({ contextId, enabled: true })
  },
)
