// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { setCodingGuardrails } from '../../../../src/coding-credentials/guardrails.js'
import { updateCodingCredentials } from '../../../../src/coding-credentials/store.js'
import { upsertRepo } from '../../../../src/coding-repos/store.js'
import { getCodingSessionRecord } from '../../../../src/coding-sessions/store.js'
import { createFakeMagi } from '../../harness/fake-magi.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability } from '../../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-qualification-magi-token'
const PROVIDER_KEY = 'scenario-qualification-provider-key'
const START_WIRE_NAME = 'plugin_acp__start_session'

const configureProject = (contextId: string, userId: string): void => {
  upsertRepo(
    contextId,
    {
      name: 'papai',
      repoUrl: 'https://github.com/acme/papai.git',
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

scenario(
  'SCN-coding-acp-start-fresh: starts a configured session through the real ACP tool loop',
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
    configureProject(contextId, alice.id)
    configureCredentials(contextId, alice.id)
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectStartSession({
      id: 'configured-session',
      expected: { contextId, project: 'papai', prompt: 'Add health check', agent: 'claude' },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add health check' }),
      answer('The coding session is running.'),
    ])

    await when.message(alice, dm, 'Add a health check')

    then.replyTo(alice).equals('The coding session is running.')
    expect(world.model.inspections().some(({ availableTools }) => availableTools.includes(START_WIRE_NAME))).toBe(true)
    expect(getCodingSessionRecord(contextId, 'configured-session')?.project).toBe('papai')
    expect(world.events.all().some(({ kind }) => kind === 'magi.session.start')).toBe(true)
  },
)

scenario(
  'SCN-coding-acp-not-configured: refuses an unconfigured start without creating a session',
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
    configureProject(contextId, alice.id)
    createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add health check' }),
      answer('Coding credentials are not configured.'),
    ])

    await when.message(alice, dm, 'Add a health check')

    then.replyTo(alice).equals('Coding credentials are not configured.')
    expect(getCodingSessionRecord(contextId, 'missing-config-session')).toBeNull()
    expect(world.events.all().some(({ kind }) => kind === 'magi.session.start')).toBe(false)
    expect(world.events.all().some(({ kind }) => kind === 'http.request')).toBe(false)
  },
)

scenario(
  'SCN-coding-acp-guest-denied: hides session start from a guest group turn',
  async ({ given, when, then, world }) => {
    const member = given.user('member')
    const guest = given.guest('guest')
    const group = given.group('engineering')
    given.member(group, member)
    given.guestMode(group, true)
    given.codingSession({
      pluginDirectory: 'plugins',
      context: group,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: member.id,
    })
    createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    given.llm([answer('Coding sessions are unavailable to guests.')])

    await when.message(guest, group, 'Start a coding session')

    then.replyIn(group).equals('Coding sessions are unavailable to guests.')
    expect(world.model.inspections().every(({ availableTools }) => !availableTools.includes(START_WIRE_NAME))).toBe(
      true,
    )
    expect(world.events.all().some(({ kind }) => kind === 'http.request')).toBe(false)
    const groupContextId = toScopedContextId({
      platformInstanceId: group.platformInstanceId,
      nativeContextId: group.id,
    })
    expect(getCodingSessionRecord(groupContextId, 'guest-denied-session')).toBeNull()
  },
)

scenario(
  'SCN-coding-acp-whomayuse-denied: hides session start from an operator-denied member',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    setCodingGuardrails(alice.platformInstanceId, {
      allowedAgents: ['claude', 'codex', 'opencode'],
      whoMayUse: ['another-user'],
      forceSharedKey: false,
      maxMcpServers: 3,
    })
    given.codingSession({
      pluginDirectory: 'plugins',
      context: dm,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: alice.id,
    })
    configureProject(contextId, alice.id)
    configureCredentials(contextId, alice.id)
    createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    given.llm([answer('Coding sessions are not permitted for this member.')])

    await when.message(alice, dm, 'Start a coding session')

    then.replyTo(alice).equals('Coding sessions are not permitted for this member.')
    expect(world.model.inspections().every(({ availableTools }) => !availableTools.includes(START_WIRE_NAME))).toBe(
      true,
    )
    expect(world.events.all().some(({ kind }) => kind === 'http.request')).toBe(false)
    expect(getCodingSessionRecord(contextId, 'operator-denied-session')).toBeNull()
  },
)

scenario(
  'configured ACP upstream failure does not persist a session or expose credentials',
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
    configureProject(contextId, alice.id)
    configureCredentials(contextId, alice.id)
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectStartFailure({
      status: 503,
      body: { id: 'failed-session', error: 'magi is temporarily unavailable' },
      expected: { contextId, project: 'papai', prompt: 'Add health check', agent: 'claude' },
    })
    given.llm([
      callCapability('coding-session.start', { project: 'papai', prompt: 'Add health check' }),
      answer('The coding session service is temporarily unavailable.'),
    ])

    await when.message(alice, dm, 'Add a health check')

    then.replyTo(alice).equals('The coding session service is temporarily unavailable.')
    expect(getCodingSessionRecord(contextId, 'failed-session')).toBeNull()
    expect(world.events.all().some(({ kind }) => kind === 'magi.session.start')).toBe(true)
    const trace = JSON.stringify(world.events.all())
    expect(trace).not.toContain(MAGI_TOKEN)
    expect(trace).not.toContain(PROVIDER_KEY)
  },
)
