// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { updateCodingCredentials } from '../../../../src/coding-credentials/store.js'
import { upsertRepo } from '../../../../src/coding-repos/store.js'
import { getCodingSessionRecord, setCodingSessionRecord } from '../../../../src/coding-sessions/store.js'
import { kvList } from '../../../../src/plugins/store.js'
import { createFakeMagi } from '../../harness/fake-magi.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-lifecycle-magi-token'
const PROVIDER_KEY = 'scenario-lifecycle-provider-key'
const FORGE_TOKEN = 'scenario-lifecycle-forge-token'

const contextIdFor = (user: { id: string; platformInstanceId: string }): string =>
  toScopedContextId({ platformInstanceId: user.platformInstanceId, nativeContextId: user.id })

const configureProject = (
  contextId: string,
  userId: string,
  values: Readonly<{ name?: string; repoUrl?: string }> = {},
): void => {
  upsertRepo(
    contextId,
    {
      name: values.name ?? 'papai',
      repoUrl: values.repoUrl ?? 'https://github.com/acme/papai.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    },
    userId,
  )
}

const configureCredentials = (contextId: string, userId: string): void => {
  updateCodingCredentials(
    contextId,
    'agent-provider',
    { agent: 'claude', provider: 'anthropic', provider_api_key: PROVIDER_KEY },
    userId,
  )
}

const configureForge = (contextId: string, userId: string): void => {
  updateCodingCredentials(contextId, 'forge', { kind: 'github', forge_token: FORGE_TOKEN }, userId)
}

const expectTraceRedacted = (trace: string): void => {
  expect(trace).not.toContain(MAGI_TOKEN)
  expect(trace).not.toContain(PROVIDER_KEY)
  expect(trace).not.toContain(FORGE_TOKEN)
}

scenario(
  'SCN-coding-acp-start-on-pr: starts a configured session with PR and forge token',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = contextIdFor(alice)
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    configureProject(contextId, alice.id)
    configureCredentials(contextId, alice.id)
    configureForge(contextId, alice.id)
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectStartSession({
      id: 'pr-session',
      expected: {
        contextId,
        project: 'papai',
        prompt: 'Review the failing tests',
        agent: 'claude',
        prNumber: 42,
        forgeToken: FORGE_TOKEN,
      },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Review the failing tests', prNumber: 42 }),
      answer('The PR review session is running.'),
    ])

    await when.message(alice, dm, 'Review PR 42')

    then.replyTo(alice).equals('The PR review session is running.')
    expect(getCodingSessionRecord(contextId, 'pr-session')).toMatchObject({ project: 'papai', prNumber: 42 })
    expect(
      world.events
        .all()
        .some(({ kind, data }) => kind === 'magi.session.start' && JSON.stringify(data).includes('"prNumber":42')),
    ).toBe(true)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario(
  'SCN-coding-acp-self-hosted-forge-preflight: refuses a self-hosted repository without forge settings',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = contextIdFor(alice)
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    configureProject(contextId, alice.id, { repoUrl: 'https://git.acme.invalid/platform/papai.git' })
    configureCredentials(contextId, alice.id)
    createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    const recordCountBefore = kvList('acp', contextId, 'session:').length
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add a health check' }),
      answer('Configure the self-hosted code host before starting a session.'),
    ])

    await when.message(alice, dm, 'Add a health check')

    then.replyTo(alice).equals('Configure the self-hosted code host before starting a session.')
    expect(kvList('acp', contextId, 'session:')).toHaveLength(recordCountBefore)
    expect(world.events.all().some(({ kind }) => kind === 'http.request')).toBe(false)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario(
  'SCN-coding-acp-list-projects: lists the local repository catalogue without Magi',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = contextIdFor(alice)
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    configureProject(contextId, alice.id)
    createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    given.llm([callCapability('coding-session.projects.list', {}), answer('papai is configured.')])

    await when.message(alice, dm, 'Which coding projects are configured?')

    then.replyTo(alice).equals('papai is configured.')
    const wire = world.runtime.resolveToolCapability('coding-session.projects.list')
    expect(world.model.inspections().some(({ availableTools }) => availableTools.includes(wire))).toBe(true)
    expect(world.events.all().some(({ kind }) => kind === 'http.request')).toBe(false)
  },
)

scenario(
  'SCN-coding-acp-list-agents: gets available agents through guarded Magi HTTP',
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
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectAgents([{ id: 'claude', name: 'Claude' }])
    given.llm([callCapability('coding-session.agents.list', {}), answer('Claude is available.')])

    await when.message(alice, dm, 'Which coding agents are available?')

    then.replyTo(alice).equals('Claude is available.')
    expect(world.events.all().some(({ kind }) => kind === 'magi.agents.list')).toBe(true)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario(
  'SCN-coding-acp-list-sessions: returns only sessions known to this chat',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = contextIdFor(alice)
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    setCodingSessionRecord(contextId, 'local-session', {
      project: 'papai',
      title: 'Local coding work',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectSessions('active', [
      { id: 'local-session', status: 'active' },
      { id: 'foreign-session', status: 'active' },
    ])
    given.llm([callCapability('coding-session.list', { filter: 'active' }), answer('One local session is active.')])

    await when.message(alice, dm, 'Which sessions are active?')

    then.replyTo(alice).equals('One local session is active.')
    expect(getCodingSessionRecord(contextId, 'local-session')).toMatchObject({ status: 'active' })
    const toolResultPrompt = world.model.inspections().at(-1)?.promptTokenFingerprints ?? []
    expect(toolResultPrompt).toContain(promptTextFingerprint('local'))
    expect(toolResultPrompt).not.toContain(promptTextFingerprint('foreign'))
    expect(world.events.all().some(({ kind }) => kind === 'magi.sessions.list')).toBe(true)
  },
)

scenario(
  'SCN-coding-acp-session-status: preserves a declared missing-session response without local mutation',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = contextIdFor(alice)
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    const recordBefore = {
      project: 'papai',
      title: 'Existing local history',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    }
    setCodingSessionRecord(contextId, 'missing-session', recordBefore)
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectSession('missing-session', { error: 'not found' }, { status: 404 })
    given.llm([
      callCapability('coding-session.status', { sessionId: 'missing-session' }),
      answer('That coding session no longer exists in Magi.'),
    ])

    await when.message(alice, dm, 'What is the status of missing-session?')

    then.replyTo(alice).equals('That coding session no longer exists in Magi.')
    expect(getCodingSessionRecord(contextId, 'missing-session')).toEqual(recordBefore)
    expect(world.events.all().some(({ kind }) => kind === 'magi.session.status')).toBe(true)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)
