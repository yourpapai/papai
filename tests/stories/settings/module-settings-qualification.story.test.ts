// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { upsertRepo } from '../../../src/coding-repos/store.js'
import { createFakeMagi } from '../harness/fake-magi.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-settings-magi-token'
const PROVIDER_KEY = 'scenario-settings-provider-key'

const credentialResponseSchema = z.object({
  configured: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  fields: z.array(z.object({ key: z.string(), hasValue: z.boolean(), value: z.string() })),
})

const agentProviderRequest = (contextId: string): string =>
  JSON.stringify({
    contextId,
    namespace: 'agent-provider',
    values: { agent: 'claude', provider: 'anthropic', provider_api_key: PROVIDER_KEY },
  })

const expectUnconfigured = async (response: Response): Promise<void> => {
  expect(credentialResponseSchema.parse(await response.json())).toMatchObject({ configured: false, complete: false })
}

scenario(
  'SCN-settings-coding-agent-provider: updates coding credentials through settings and changes the next chat turn',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const dm = given.dm(alice)
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    const bobContextId = toScopedContextId({ platformInstanceId: bob.platformInstanceId, nativeContextId: bob.id })
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
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
    const session = await given.settingsSession(alice)
    const bobSession = await when.settingsSession(bob)
    const body = agentProviderRequest(contextId)

    const unauthenticated = await when.request('/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(unauthenticated, 401)

    const afterUnauthenticated = await when.settingsRequest(
      session,
      '/settings/api/coding-credentials?namespace=agent-provider',
    )
    then.responseStatus(afterUnauthenticated, 200)
    await expectUnconfigured(afterUnauthenticated)

    const csrfRejected = await when.settingsRequest(
      session,
      '/settings/api/coding-credentials',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const afterCsrfRejected = await when.settingsRequest(
      session,
      '/settings/api/coding-credentials?namespace=agent-provider',
    )
    then.responseStatus(afterCsrfRejected, 200)
    await expectUnconfigured(afterCsrfRejected)

    const before = await when.settingsRequest(session, '/settings/api/coding-credentials?namespace=agent-provider')
    then.responseStatus(before, 200)
    await expectUnconfigured(before)

    const malformed = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    })
    then.responseStatus(malformed, 400)

    const afterMalformed = await when.settingsRequest(
      session,
      '/settings/api/coding-credentials?namespace=agent-provider',
    )
    then.responseStatus(afterMalformed, 200)
    await expectUnconfigured(afterMalformed)

    const crossContext = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: agentProviderRequest(bobContextId),
    })
    then.responseStatus(crossContext, 403)

    const afterCrossContext = await when.settingsRequest(
      session,
      '/settings/api/coding-credentials?namespace=agent-provider',
    )
    then.responseStatus(afterCrossContext, 200)
    await expectUnconfigured(afterCrossContext)

    const bobAfterCrossContext = await when.settingsRequest(
      bobSession,
      '/settings/api/coding-credentials?namespace=agent-provider',
    )
    then.responseStatus(bobAfterCrossContext, 200)
    await expectUnconfigured(bobAfterCrossContext)

    const updated = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(updated, 200)

    const observed = await when.settingsRequest(session, '/settings/api/coding-credentials?namespace=agent-provider')
    then.responseStatus(observed, 200)
    const credentials = credentialResponseSchema.parse(await observed.json())
    expect(credentials).toMatchObject({ configured: true, complete: true })
    const apiKey = credentials.fields.find(({ key }) => key === 'provider_api_key')
    expect(apiKey?.hasValue).toBe(true)
    expect(apiKey?.value).not.toBe(PROVIDER_KEY)

    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectStartSession({
      id: 'settings-session',
      expected: { contextId, project: 'papai', prompt: 'Add health check', agent: 'claude' },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add health check' }),
      answer('The settings-backed coding session is running.'),
    ])

    await when.message(alice, dm, 'Add a health check')

    then.replyTo(alice).equals('The settings-backed coding session is running.')
    const trace = JSON.stringify(world.events.all())
    expect(trace).not.toContain(MAGI_TOKEN)
    expect(trace).not.toContain(PROVIDER_KEY)
  },
)
