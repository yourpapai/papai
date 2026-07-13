// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { createFakeMagi } from '../../harness/fake-magi.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability } from '../../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-mcp-magi-token'
const PROVIDER_KEY = 'scenario-mcp-provider-key'
const MCP_TOKEN = 'scenario-mcp-upstream-token'

const expectTraceRedacted = (trace: string): void => {
  expect(trace).not.toContain(MAGI_TOKEN)
  expect(trace).not.toContain(PROVIDER_KEY)
  expect(trace).not.toContain(MCP_TOKEN)
}

scenario(
  'SCN-coding-acp-mcp-session: starts a session with an exact configured MCP upstream and credential map',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
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
      selections: [{ server: 'docs', upstreamToken: MCP_TOKEN }],
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectStartSession({
      id: 'mcp-session',
      expected: {
        contextId: coding.contextId,
        project: 'papai',
        prompt: 'Find the documented API for the health check',
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
      callCapability('coding-session.start', {
        project: 'papai',
        prompt: 'Find the documented API for the health check',
      }),
      answer('The MCP-enabled coding session is running.'),
    ])

    await when.message(alice, dm, 'Start a coding session and use the documentation MCP server')

    then.replyTo(alice).equals('The MCP-enabled coding session is running.')
    then.codingSessions(dm).session('mcp-session').matches({
      project: 'papai',
      title: 'Find the documented API for the health check',
    })
    expect(world.events.all().some(({ kind }) => kind === 'magi.session.start')).toBe(true)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario(
  'an unresolved MCP selection fails closed before Magi session startup',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.codingSession({
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
      catalog: [],
      selections: [{ server: 'removed-docs', upstreamToken: MCP_TOKEN }],
    })
    createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    given.llm([
      callCapability('coding-session.start', {
        project: 'papai',
        prompt: 'Find the documented API for the health check',
      }),
      answer('The selected documentation MCP server is unavailable.'),
    ])

    await when.message(alice, dm, 'Start a coding session with the removed documentation MCP server')

    then.replyTo(alice).equals('The selected documentation MCP server is unavailable.')
    then.codingSessions(dm).count(0)
    expect(world.events.all().some(({ kind }) => kind === 'http.request')).toBe(false)
    expect(world.events.all().some(({ kind }) => kind === 'magi.session.start')).toBe(false)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario('malformed MCP settings fail closed before Magi session startup', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.codingSession({
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
    catalog: [],
    malformedSettings: `{not-json:${MCP_TOKEN}`,
  })
  createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
  given.llm([
    callCapability('coding-session.start', {
      project: 'papai',
      prompt: 'Find the documented API for the health check',
    }),
    answer('The selected documentation MCP settings are invalid.'),
  ])

  await when.message(alice, dm, 'Start a coding session with malformed MCP settings')

  then.replyTo(alice).equals('The selected documentation MCP settings are invalid.')
  then.codingSessions(dm).count(0)
  expect(world.events.all().some(({ kind }) => kind === 'http.request')).toBe(false)
  expect(world.events.all().some(({ kind }) => kind === 'magi.session.start')).toBe(false)
  expectTraceRedacted(JSON.stringify(world.events.all()))
})
