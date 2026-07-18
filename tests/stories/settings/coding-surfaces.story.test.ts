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

scenario(
  'SCN-settings-coding-forge: forge credentials saved through settings reach the session start',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    const coding = given.codingSession({
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

    const saved = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextId,
        namespace: 'forge',
        values: { kind: 'gitlab', instance_url: 'https://git.acme.invalid', forge_token: FORGE_TOKEN },
      }),
    })
    then.responseStatus(saved, 200)

    const observed = await when.settingsRequest(session, '/settings/api/coding-credentials?namespace=forge')
    then.responseStatus(observed, 200)
    expect(JSON.stringify(await observed.json())).not.toContain(FORGE_TOKEN)

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
  },
)

scenario(
  'SCN-settings-coding-mcp: MCP selections saved through settings reach the session start',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    const coding = given.codingSession({
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

    const saved = await when.settingsRequest(session, '/settings/api/coding-credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextId,
        namespace: 'mcp',
        values: { servers: JSON.stringify([{ server: 'docs', upstream_token: MCP_TOKEN }]) },
      }),
    })
    then.responseStatus(saved, 200)

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
  },
)

scenario(
  'SCN-settings-coding-repos: a repository registered through settings is listed and startable',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
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

    const registered = await when.settingsRequest(session, '/settings/api/coding-repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextId,
        name: 'papai',
        repoUrl: 'https://github.com/acme/papai.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
    })
    then.responseStatus(registered, 200)

    const listed = await when.settingsRequest(session, '/settings/api/coding-repos')
    then.responseStatus(listed, 200)
    expect(ReposSchema.parse(await listed.json()).repos.map((repo) => repo.name)).toContain('papai')

    createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    given.llm([callCapability('coding-session.projects.list', {}), answer('papai is configured.')])
    await when.message(alice, dm, 'List my coding projects')

    then.replyTo(alice).equals('papai is configured.')
  },
)
