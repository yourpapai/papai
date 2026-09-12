// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { messageMetadata } from '../../../src/db/schema.js'
import { scenario } from '../harness/scenario.js'

const SEEDED_API_KEY = 'scenario-api-key'

const ProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  baseUrl: z.string(),
  apiKeyMasked: z.string(),
})
const ProvidersViewSchema = z.object({ providers: z.array(ProviderSchema) })
const ProviderWriteSchema = z.object({ provider: ProviderSchema })
const RolesViewSchema = z.object({
  roles: z
    .object({
      main: z.object({ providerId: z.string(), model: z.string() }),
      small: z.object({ providerId: z.string(), model: z.string() }).nullable(),
    })
    .nullable(),
})
const UsersViewSchema = z.object({
  users: z.array(z.object({ platform_user_id: z.string(), blocked_at: z.number().nullable() })),
})
const OkSchema = z.object({ ok: z.boolean() })
const OpenAccessSchema = z.object({ openDmAccess: z.boolean() })
const GroupsViewSchema = z.object({ groups: z.array(z.object({ group_id: z.string() })) })
const CatalogViewSchema = z.object({
  entries: z.array(z.object({ name: z.string(), upstream_url: z.string(), default_tool_policy: z.string() })),
})
const PluginServersViewSchema = z.object({
  available: z.array(z.object({ pluginId: z.string() })),
  configs: z.array(z.object({ plugin_id: z.string(), enabled: z.boolean() })),
})
const PurgeSchema = z.object({ scopeId: z.string(), purged: z.number() })

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

scenario(
  'SCN-settings-admin-llm-providers: an admin relabels the LLM provider and rebinds the model roles',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const admin = await given.settingsAdminSession(alice)
    const member = await when.settingsSession(bob)

    const listed = await when.settingsRequest(admin, '/settings/api/admin/providers')
    then.responseStatus(listed, 200)
    const listedText = await listed.clone().text()
    // The masked view is the only place a stored key may surface.
    expect(listedText).not.toContain(SEEDED_API_KEY)
    const { providers } = ProvidersViewSchema.parse(await listed.json())
    const seeded = providers[0]
    expect(seeded).toBeDefined()
    if (seeded === undefined) return
    expect(seeded.apiKeyMasked).toBe(`****${SEEDED_API_KEY.slice(-4)}`)

    const forbidden = await when.settingsRequest(member, '/settings/api/admin/providers')
    then.responseStatus(forbidden, 403)

    const csrfRejected = await when.settingsRequest(
      admin,
      `/settings/api/admin/providers/${seeded.id}`,
      jsonInit('PATCH', { label: 'never applied' }),
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const patched = await when.settingsRequest(
      admin,
      `/settings/api/admin/providers/${seeded.id}`,
      // No apiKey or baseUrl: the route only reverifies when the endpoint moves,
      // and a scenario must not make an undeclared outbound call.
      jsonInit('PATCH', { label: 'primary', models: ['scenario-main-model', 'scenario-small-model'] }),
    )
    then.responseStatus(patched, 200)
    expect(ProviderWriteSchema.parse(await patched.json()).provider.label).toBe('primary')

    const missing = await when.settingsRequest(
      admin,
      '/settings/api/admin/providers/no-such-provider',
      jsonInit('PATCH', { label: 'primary' }),
    )
    then.responseStatus(missing, 404)

    const rolesBefore = await when.settingsRequest(admin, '/settings/api/admin/llm-roles')
    then.responseStatus(rolesBefore, 200)
    expect(RolesViewSchema.parse(await rolesBefore.json()).roles?.main.providerId).toBe(seeded.id)

    const rebound = await when.settingsRequest(
      admin,
      '/settings/api/admin/llm-roles',
      jsonInit('PUT', {
        main: { providerId: seeded.id, model: 'scenario-main-model' },
        small: { providerId: seeded.id, model: 'scenario-small-model' },
        embedding: null,
      }),
    )
    then.responseStatus(rebound, 200)

    const rolesAfter = await when.settingsRequest(admin, '/settings/api/admin/llm-roles')
    then.responseStatus(rolesAfter, 200)
    expect(RolesViewSchema.parse(await rolesAfter.json()).roles?.small?.model).toBe('scenario-small-model')

    // Deleting the provider the main role points at would leave the bot with no
    // model at all, so the store refuses it.
    const deleted = await when.settingsRequest(admin, `/settings/api/admin/providers/${seeded.id}`, {
      method: 'DELETE',
    })
    then.responseStatus(deleted, 409)

    const stillListed = await when.settingsRequest(admin, '/settings/api/admin/providers')
    then.responseStatus(stillListed, 200)
    expect(ProvidersViewSchema.parse(await stillListed.json()).providers.map((p) => p.id)).toContain(seeded.id)
  },
)

scenario(
  'SCN-settings-admin-roster-access: an admin manages the member roster, open DM access, and authorized groups',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const admin = await given.settingsAdminSession(alice)
    const member = await when.settingsSession(bob)
    const newcomerId = '900001'

    const forbidden = await when.settingsRequest(member, '/settings/api/admin/users')
    then.responseStatus(forbidden, 403)

    const before = await when.settingsRequest(admin, '/settings/api/admin/users')
    then.responseStatus(before, 200)
    expect(UsersViewSchema.parse(await before.json()).users.map((u) => u.platform_user_id)).not.toContain(newcomerId)

    const added = await when.settingsRequest(
      admin,
      '/settings/api/admin/users',
      jsonInit('POST', { userId: newcomerId, username: 'carol' }),
    )
    then.responseStatus(added, 200)
    expect(OkSchema.parse(await added.json()).ok).toBe(true)

    const afterAdd = await when.settingsRequest(admin, '/settings/api/admin/users')
    expect(UsersViewSchema.parse(await afterAdd.json()).users.map((u) => u.platform_user_id)).toContain(newcomerId)

    const blocked = await when.settingsRequest(
      admin,
      '/settings/api/admin/users/block',
      jsonInit('POST', { userId: newcomerId, blocked: true }),
    )
    then.responseStatus(blocked, 200)
    expect(OkSchema.parse(await blocked.json()).ok).toBe(true)

    const removed = await when.settingsRequest(
      admin,
      '/settings/api/admin/users',
      jsonInit('DELETE', { userId: newcomerId }),
    )
    then.responseStatus(removed, 200)
    expect(OkSchema.parse(await removed.json()).ok).toBe(true)

    const afterRemove = await when.settingsRequest(admin, '/settings/api/admin/users')
    expect(UsersViewSchema.parse(await afterRemove.json()).users.map((u) => u.platform_user_id)).not.toContain(
      newcomerId,
    )

    const accessBefore = await when.settingsRequest(admin, '/settings/api/admin/open-access')
    then.responseStatus(accessBefore, 200)
    expect(OpenAccessSchema.parse(await accessBefore.json()).openDmAccess).toBe(false)

    const opened = await when.settingsRequest(
      admin,
      '/settings/api/admin/open-access',
      jsonInit('POST', { enabled: true }),
    )
    then.responseStatus(opened, 200)

    const accessAfter = await when.settingsRequest(admin, '/settings/api/admin/open-access')
    expect(OpenAccessSchema.parse(await accessAfter.json()).openDmAccess).toBe(true)

    const nativeGroupId = 'ops-room'
    const scopedGroupId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: nativeGroupId,
    })

    const groupsBefore = await when.settingsRequest(admin, '/settings/api/admin/groups')
    then.responseStatus(groupsBefore, 200)
    expect(GroupsViewSchema.parse(await groupsBefore.json()).groups.map((g) => g.group_id)).not.toContain(scopedGroupId)

    const authorized = await when.settingsRequest(
      admin,
      '/settings/api/admin/groups',
      jsonInit('POST', { groupId: nativeGroupId }),
    )
    then.responseStatus(authorized, 200)

    const groupsAfter = await when.settingsRequest(admin, '/settings/api/admin/groups')
    expect(GroupsViewSchema.parse(await groupsAfter.json()).groups.map((g) => g.group_id)).toContain(scopedGroupId)

    const revoked = await when.settingsRequest(
      admin,
      '/settings/api/admin/groups',
      jsonInit('DELETE', { groupId: scopedGroupId }),
    )
    then.responseStatus(revoked, 200)
    expect(OkSchema.parse(await revoked.json()).ok).toBe(true)

    const groupsFinal = await when.settingsRequest(admin, '/settings/api/admin/groups')
    expect(GroupsViewSchema.parse(await groupsFinal.json()).groups.map((g) => g.group_id)).not.toContain(scopedGroupId)
  },
)

scenario(
  'SCN-settings-admin-mcp-and-history: an admin edits the MCP catalog while only a super admin may purge history',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    given.admin(bob)
    const superAdmin = await given.settingsAdminSession(alice, { superAdmin: true })
    const plainAdmin = await when.settingsSession(bob)

    const catalogBefore = await when.settingsRequest(superAdmin, '/settings/api/admin/mcp-catalog')
    then.responseStatus(catalogBefore, 200)
    expect(CatalogViewSchema.parse(await catalogBefore.json()).entries).toEqual([])

    const invalid = await when.settingsRequest(
      superAdmin,
      '/settings/api/admin/mcp-catalog',
      // http, not https: the catalog schema refuses a plaintext upstream.
      jsonInit('POST', { kind: 'catalog', entries: [{ name: 'docs', upstream_url: 'http://mcp.invalid/sse' }] }),
    )
    then.responseStatus(invalid, 422)

    const saved = await when.settingsRequest(
      superAdmin,
      '/settings/api/admin/mcp-catalog',
      jsonInit('POST', {
        kind: 'catalog',
        entries: [{ name: 'docs', upstream_url: 'https://mcp.invalid/sse', default_tool_policy: 'ask' }],
      }),
    )
    then.responseStatus(saved, 200)
    expect(CatalogViewSchema.parse(await saved.json()).entries).toEqual([
      { name: 'docs', upstream_url: 'https://mcp.invalid/sse', default_tool_policy: 'ask' },
    ])

    const catalogAfter = await when.settingsRequest(superAdmin, '/settings/api/admin/mcp-catalog')
    expect(CatalogViewSchema.parse(await catalogAfter.json()).entries).toHaveLength(1)

    const pluginServers = await when.settingsRequest(superAdmin, '/settings/api/admin/mcp-plugin-servers')
    then.responseStatus(pluginServers, 200)
    expect(PluginServersViewSchema.parse(await pluginServers.json()).configs).toEqual([])

    const scopeId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: 'archive' })
    const otherScopeId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: 'keep' })
    const db = getDrizzleDb()
    db.insert(messageMetadata)
      .values([
        { contextId: scopeId, messageId: 'm1', groupContextId: scopeId, timestamp: 1 },
        { contextId: otherScopeId, messageId: 'm2', groupContextId: otherScopeId, timestamp: 2 },
      ])
      .run()

    const purgePath = `/settings/api/admin/contexts/${scopeId}/message-history`
    const refused = await when.settingsRequest(plainAdmin, purgePath, { method: 'DELETE' })
    then.responseStatus(refused, 403)

    const purged = await when.settingsRequest(superAdmin, purgePath, { method: 'DELETE' })
    then.responseStatus(purged, 200)
    expect(PurgeSchema.parse(await purged.json())).toEqual({ scopeId, purged: 1 })

    const remaining = db.select().from(messageMetadata).all()
    expect(remaining.map((row) => row.messageId)).toEqual(['m2'])
  },
)
