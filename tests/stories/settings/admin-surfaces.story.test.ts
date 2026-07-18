// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { createFakeMagi } from '../harness/fake-magi.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-admin-settings-magi-token'
const PROVIDER_KEY = 'scenario-admin-settings-provider-key'
const START_WIRE_NAME = 'plugin_acp__start_session'

const AdminsSchema = z.object({ admins: z.array(z.object({ userId: z.string(), platformInstanceId: z.string() })) })
const BroadcastSchema = z.object({ totalUsers: z.number(), successCount: z.number(), failCount: z.number() })
const GuardrailsViewSchema = z.object({
  guardrails: z.object({ whoMayUse: z.union([z.literal('members'), z.array(z.string())]) }),
})

scenario(
  'SCN-settings-admin-guardrails: a guardrail saved through settings changes the advertised toolset',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const dm = given.dm(alice)
    const bobDm = given.dm(bob)
    const aliceContextId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: alice.id,
    })
    const bobContextId = toScopedContextId({ platformInstanceId: bob.platformInstanceId, nativeContextId: bob.id })
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    given.codingSession({
      pluginDirectory: 'plugins',
      context: bobDm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: bob.id,
    })
    given.codingProject({
      context: dm,
      updatedBy: alice.id,
      name: 'papai',
      repoUrl: 'https://github.com/acme/papai.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    })
    given.codingProject({
      context: bobDm,
      updatedBy: bob.id,
      name: 'papai',
      repoUrl: 'https://github.com/acme/papai.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    })
    given.codingCredentials({
      context: dm,
      updatedBy: alice.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
    })
    given.codingCredentials({
      context: bobDm,
      updatedBy: bob.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
    })
    const admin = await given.settingsAdminSession(alice)
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })

    magi.expectStartSession({
      id: 'bob-guardrail-session',
      expected: { contextId: bobContextId, project: 'papai', prompt: 'Add a health check', agent: 'claude' },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add a health check' }),
      answer('Your coding session is running.'),
    ])
    await when.message(bob, bobDm, 'Start a coding session')
    then.replyTo(bob).equals('Your coding session is running.')
    then.codingSessions(bobDm).count(1)
    expect(world.model.inspections().some(({ availableTools }) => availableTools.includes(START_WIRE_NAME))).toBe(true)
    const preGuardrailGenerations = world.model.inspections().length

    const unauthenticated = await when.request('/settings/api/admin/coding-guardrails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'policy', guardrails: { whoMayUse: [alice.id] } }),
    })
    then.responseStatus(unauthenticated, 401)

    const unknownKind = await when.settingsRequest(admin, '/settings/api/admin/coding-guardrails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'bogus', guardrails: {} }),
    })
    then.responseStatus(unknownKind, 422)

    const denied = await when.settingsRequest(
      await when.settingsSession(bob),
      '/settings/api/admin/coding-guardrails',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'policy', guardrails: { whoMayUse: [alice.id] } }),
      },
    )
    then.responseStatus(denied, 403)

    const saved = await when.settingsRequest(admin, '/settings/api/admin/coding-guardrails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'policy', guardrails: { whoMayUse: [alice.id] } }),
    })
    then.responseStatus(saved, 200)
    expect(GuardrailsViewSchema.parse(await saved.json()).guardrails.whoMayUse).toEqual([alice.id])

    given.llm([answer('Coding sessions are unavailable for your account.')])
    await when.message(bob, bobDm, 'Start a coding session')
    then.replyTo(bob).equals('Coding sessions are unavailable for your account.')
    const deniedGenerations = world.model.inspections().slice(preGuardrailGenerations)
    expect(deniedGenerations.length).toBeGreaterThan(0)
    expect(deniedGenerations.every(({ availableTools }) => !availableTools.includes(START_WIRE_NAME))).toBe(true)
    then.codingSessions(bobDm).count(1)
    const preAllowlistGenerations = world.model.inspections().length

    magi.expectStartSession({
      id: 'alice-guardrail-session',
      expected: { contextId: aliceContextId, project: 'papai', prompt: 'Add a health check', agent: 'claude' },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add a health check' }),
      answer('Your session is running.'),
    ])
    await when.message(alice, dm, 'Start a coding session')
    then.replyTo(alice).equals('Your session is running.')
    then.codingSessions(dm).count(1)
    expect(
      world.model
        .inspections()
        .slice(preAllowlistGenerations)
        .some(({ availableTools }) => availableTools.includes(START_WIRE_NAME)),
    ).toBe(true)

    const trace = JSON.stringify(world.events.all())
    expect(trace).not.toContain(MAGI_TOKEN)
    expect(trace).not.toContain(PROVIDER_KEY)
  },
)

scenario(
  'SCN-settings-admin-system-access: granting admin through settings flips admin authorization',
  async ({ given, when, then, world }) => {
    const root = given.user('root')
    const bob = given.user('bob')
    const carol = given.user('carol')
    world.fixtures.seedAdmin({ userId: carol.id, platformInstanceId: carol.platformInstanceId })
    const superSession = await given.settingsAdminSession(root, { superAdmin: true })
    const bobSession = await when.settingsSession(bob)
    const carolSession = await when.settingsSession(carol)
    const grantBody = JSON.stringify({ userId: bob.id, platformInstanceId: bob.platformInstanceId })

    const unauthenticated = await when.request('/settings/api/admin/admins')
    then.responseStatus(unauthenticated, 401)

    const before = await when.settingsRequest(bobSession, '/settings/api/admin/admins')
    then.responseStatus(before, 403)

    const notSuper = await when.settingsRequest(carolSession, '/settings/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: grantBody,
    })
    then.responseStatus(notSuper, 403)

    const granted = await when.settingsRequest(superSession, '/settings/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: grantBody,
    })
    then.responseStatus(granted, 200)

    const after = await when.settingsRequest(bobSession, '/settings/api/admin/admins')
    then.responseStatus(after, 200)
    expect(AdminsSchema.parse(await after.json()).admins.map((admin) => admin.userId)).toContain(bob.id)

    const revoked = await when.settingsRequest(superSession, '/settings/api/admin/admins', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: grantBody,
    })
    then.responseStatus(revoked, 200)

    const final = await when.settingsRequest(bobSession, '/settings/api/admin/admins')
    then.responseStatus(final, 403)
  },
)

scenario(
  'SCN-settings-admin-roster-announce: an admin broadcast reaches every authorized user',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const admin = await given.settingsAdminSession(alice)
    const bobSession = await when.settingsSession(bob)
    const body = JSON.stringify({ message: 'Maintenance tonight at 22:00.' })

    const emptyMessage = await when.settingsRequest(admin, '/settings/api/admin/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    })
    then.responseStatus(emptyMessage, 422)

    const denied = await when.settingsRequest(bobSession, '/settings/api/admin/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(denied, 403)

    const sent = await when.settingsRequest(admin, '/settings/api/admin/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(sent, 200)
    expect(BroadcastSchema.parse(await sent.json())).toMatchObject({ totalUsers: 2, successCount: 2, failCount: 0 })

    then.replyTo(alice).equals('Maintenance tonight at 22:00.')
    then.replyTo(bob).equals('Maintenance tonight at 22:00.')
  },
)
