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
const MAGI_TOKEN = 'scenario-coding-settings-magi-token'
const PROVIDER_KEY = 'scenario-coding-settings-provider-key'
const FORGE_TOKEN = 'scenario-coding-settings-forge-token'
const MCP_TOKEN = 'scenario-coding-settings-mcp-upstream-token'

const ReposSchema = z.object({ repos: z.array(z.object({ repoId: z.string(), name: z.string() })) })

const credentialResponseSchema = z.object({
  configured: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  fields: z.array(z.object({ key: z.string(), hasValue: z.boolean(), value: z.string() })),
})

const mcpViewSchema = z.object({
  selections: z.array(z.object({ server: z.string(), hasToken: z.boolean() })),
})

scenario(
  'SCN-settings-coding-forge: forge credentials saved through settings reach the session start',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const dm = given.dm(alice)
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    const bobContextId = toScopedContextId({ platformInstanceId: bob.platformInstanceId, nativeContextId: bob.id })
    const coding = await given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    given.codingProject({
      context: dm,
      updatedBy: alice.id,
      name: 'papai',
      repoUrl: 'https://git.acme.invalid/platform/papai.git',
    })
    given.codingCredentials({
      context: dm,
      updatedBy: alice.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
    })
    const session = await given.settingsSession(alice)

    const rejected = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextId,
        namespace: 'forge',
        values: { kind: 'gitlab-self-hosted', instance_url: 'http://git.acme.invalid', forge_token: FORGE_TOKEN },
      }),
    })
    then.responseStatus(rejected, 422)

    const unconfigured = await when.settingsRequest(session, '/settings/api/coding-credentials?namespace=forge')
    then.responseStatus(unconfigured, 200)
    expect(credentialResponseSchema.parse(await unconfigured.json()).configured).toBe(false)

    const forgeBody = JSON.stringify({
      contextId,
      namespace: 'forge',
      values: { kind: 'gitlab', instance_url: 'https://git.acme.invalid', forge_token: FORGE_TOKEN },
    })

    const csrfRejected = await when.settingsRequest(
      session,
      '/settings/api/coding-credentials',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: forgeBody },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const crossContext = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextId: bobContextId,
        namespace: 'forge',
        values: { kind: 'gitlab', instance_url: 'https://git.acme.invalid', forge_token: FORGE_TOKEN },
      }),
    })
    then.responseStatus(crossContext, 403)

    const saved = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: forgeBody,
    })
    then.responseStatus(saved, 200)

    const observed = await when.settingsRequest(session, '/settings/api/coding-credentials?namespace=forge')
    then.responseStatus(observed, 200)
    const forgeView = credentialResponseSchema.parse(await observed.json())
    expect(JSON.stringify(forgeView)).not.toContain(FORGE_TOKEN)
    expect(forgeView).toMatchObject({ configured: true, complete: true })
    const forgeToken = forgeView.fields.find(({ key }) => key === 'forge_token')
    expect(forgeToken?.hasValue).toBe(true)
    expect(forgeToken?.value).not.toBe(FORGE_TOKEN)

    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectStartSession({
      id: 'forge-settings-session',
      expected: {
        contextId: coding.contextId,
        project: 'papai',
        prompt: 'Add a health check',
        agent: 'claude',
        forgeToken: FORGE_TOKEN,
      },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add a health check' }),
      answer('The forge-backed session is running.'),
    ])
    await when.message(alice, dm, 'Add a health check')

    then.replyTo(alice).equals('The forge-backed session is running.')
    const trace = JSON.stringify(world.events.all())
    expect(trace).not.toContain(FORGE_TOKEN)
    expect(trace).not.toContain(MAGI_TOKEN)
    expect(trace).not.toContain(PROVIDER_KEY)
  },
)

scenario(
  'SCN-settings-coding-mcp: MCP selections saved through settings reach the session start',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    const coding = await given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    given.codingProject({
      context: dm,
      updatedBy: alice.id,
      name: 'papai',
      repoUrl: 'https://github.com/acme/papai.git',
    })
    given.codingCredentials({
      context: dm,
      updatedBy: alice.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
    })
    given.codingMcp({
      context: dm,
      updatedBy: alice.id,
      catalog: [
        {
          name: 'docs',
          upstreamUrl: 'https://mcp.example.invalid/v1',
          header: 'X-Docs-Key',
          defaultToolPolicy: 'ask',
          toolPolicy: { search: 'allow' },
        },
      ],
      selections: [],
    })
    const session = await given.settingsSession(alice)

    const malformed = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextId, namespace: 'mcp', values: { servers: 'not json' } }),
    })
    then.responseStatus(malformed, 422)

    const intact = await when.settingsRequest(session, '/settings/api/coding-credentials?namespace=mcp')
    then.responseStatus(intact, 200)
    expect(mcpViewSchema.parse(await intact.json()).selections).toEqual([])

    const mcpBody = JSON.stringify({
      contextId,
      namespace: 'mcp',
      values: { servers: JSON.stringify([{ server: 'docs', upstream_token: MCP_TOKEN }]) },
    })

    const csrfRejected = await when.settingsRequest(
      session,
      '/settings/api/coding-credentials',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: mcpBody },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const saved = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: mcpBody,
    })
    then.responseStatus(saved, 200)

    const observed = await when.settingsRequest(session, '/settings/api/coding-credentials?namespace=mcp')
    then.responseStatus(observed, 200)
    const mcpView = mcpViewSchema.parse(await observed.json())
    expect(JSON.stringify(mcpView)).not.toContain(MCP_TOKEN)
    expect(mcpView.selections).toContainEqual({ server: 'docs', hasToken: true })

    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectStartSession({
      id: 'mcp-settings-session',
      expected: {
        contextId: coding.contextId,
        project: 'papai',
        prompt: 'Find the documented API',
        agent: 'claude',
        mcp: [
          {
            id: 'docs',
            url: 'https://mcp.example.invalid/v1',
            host: 'mcp.example.invalid',
            header: 'X-Docs-Key',
            allowedHosts: ['mcp.example.invalid'],
            toolPolicy: { default: 'ask', tools: { search: 'allow' } },
          },
        ],
        mcpTokens: { docs: MCP_TOKEN },
      },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Find the documented API' }),
      answer('The MCP-enabled session is running.'),
    ])
    await when.message(alice, dm, 'Start a session and use the docs MCP server')

    then.replyTo(alice).equals('The MCP-enabled session is running.')
    const trace = JSON.stringify(world.events.all())
    expect(trace).not.toContain(MCP_TOKEN)
    expect(trace).not.toContain(MAGI_TOKEN)
    expect(trace).not.toContain(PROVIDER_KEY)
  },
)

scenario(
  'SCN-settings-coding-repos: a repository registered through settings is listed and startable',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    const coding = await given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    given.codingCredentials({
      context: dm,
      updatedBy: alice.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
    })
    const session = await given.settingsSession(alice)

    const invalid = await when.settingsRequest(session, '/settings/api/coding-repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextId,
        name: 'papai',
        repoUrl: 'git://github.com/acme/papai.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
    })
    then.responseStatus(invalid, 422)

    const empty = await when.settingsRequest(session, '/settings/api/coding-repos')
    then.responseStatus(empty, 200)
    expect(ReposSchema.parse(await empty.json()).repos).toEqual([])

    const repoBody = JSON.stringify({
      contextId,
      name: 'papai',
      repoUrl: 'https://github.com/acme/papai.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    })

    const csrfRejected = await when.settingsRequest(
      session,
      '/settings/api/coding-repos',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: repoBody },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const registered = await when.settingsRequest(session, '/settings/api/coding-repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: repoBody,
    })
    then.responseStatus(registered, 200)

    const listed = await when.settingsRequest(session, '/settings/api/coding-repos')
    then.responseStatus(listed, 200)
    expect(ReposSchema.parse(await listed.json()).repos.map((repo) => repo.name)).toContain('papai')

    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectStartSession({
      id: 'repos-settings-session',
      expected: { contextId: coding.contextId, project: 'papai', prompt: 'Add a health check', agent: 'claude' },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add a health check' }),
      answer('The registered repo is running.'),
    ])
    await when.message(alice, dm, 'Add a health check')

    then.replyTo(alice).equals('The registered repo is running.')
    const trace = JSON.stringify(world.events.all())
    expect(trace).not.toContain(PROVIDER_KEY)
    expect(trace).not.toContain(MAGI_TOKEN)
  },
)
