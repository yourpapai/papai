// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { createFakeMagi } from '../../harness/fake-magi.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability } from '../../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-controls-magi-token'
const PROVIDER_KEY = 'scenario-controls-provider-key'
const FORGE_TOKEN = 'scenario-controls-forge-token'

const expectTraceRedacted = (trace: string): void => {
  expect(trace).not.toContain(MAGI_TOKEN)
  expect(trace).not.toContain(PROVIDER_KEY)
  expect(trace).not.toContain(FORGE_TOKEN)
}

scenario(
  'SCN-coding-acp-cautious-permission-roundtrip: resolves matching cautious decisions and leaves empty queues untouched',
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
    magi.expectPermissions('allow-session', [{ toolCallId: 'allow-1' }, { toolCallId: 'allow-2' }])
    magi.expectPermissionDecision('allow-session', { toolCallId: 'allow-1', decision: 'allow' })
    magi.expectPermissionDecision('allow-session', { toolCallId: 'allow-2', decision: 'allow' })
    magi.expectPermissions('deny-session', [{ toolCallId: 'deny-1' }, { toolCallId: 'deny-2' }])
    magi.expectPermissionDecision('deny-session', { toolCallId: 'deny-1', decision: 'deny' })
    magi.expectPermissionDecision('deny-session', { toolCallId: 'deny-2', decision: 'deny' })
    magi.expectPermissions('empty-session', [])
    given.llm([
      callCapability('coding-session.permission.answer', { sessionId: 'allow-session', decision: 'allow' }),
      answer('Approved both pending coding actions.'),
      callCapability('coding-session.permission.answer', { sessionId: 'deny-session', decision: 'deny' }),
      answer('Denied both pending coding actions.'),
      callCapability('coding-session.permission.answer', { sessionId: 'empty-session', decision: 'allow' }),
      answer('There are no pending coding permissions.'),
    ])

    await when.message(alice, dm, 'Approve the pending coding actions')
    await when.message(alice, dm, 'Deny the next pending coding actions')
    await when.message(alice, dm, 'Approve anything still pending')

    then
      .repliesTo(alice)
      .equal([
        'Approved both pending coding actions.',
        'Denied both pending coding actions.',
        'There are no pending coding permissions.',
      ])
    const permissionEvents = world.events.all().filter(({ kind }) => kind === 'magi.permission.answer')
    expect(permissionEvents.map(({ data }) => data)).toEqual([
      { decision: 'allow', sessionId: 'allow-session', status: 200, toolCallId: 'allow-1' },
      { decision: 'allow', sessionId: 'allow-session', status: 200, toolCallId: 'allow-2' },
      { decision: 'deny', sessionId: 'deny-session', status: 200, toolCallId: 'deny-1' },
      { decision: 'deny', sessionId: 'deny-session', status: 200, toolCallId: 'deny-2' },
    ])
    expect(world.events.all().filter(({ kind }) => kind === 'magi.permissions.list')).toHaveLength(3)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario(
  'SCN-coding-acp-finish-push: pushes with the exact requested finish payload',
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
    given.codingCredentials({
      context: dm,
      updatedBy: alice.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
      forge: { kind: 'github', token: FORGE_TOKEN },
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectFinish('push-session', {
      action: 'push',
      message: 'Push the verified health check',
      forgeToken: FORGE_TOKEN,
    })
    given.llm([
      callCapability('coding-session.finish', {
        sessionId: 'push-session',
        action: 'push',
        message: 'Push the verified health check',
      }),
      answer('The verified health check was pushed.'),
    ])

    await when.message(alice, dm, 'Push the verified health check')

    then.replyTo(alice).equals('The verified health check was pushed.')
    expect(world.events.all().find(({ kind }) => kind === 'magi.session.finish')?.data).toEqual({
      action: 'push',
      hasPr: false,
      sessionId: 'push-session',
      status: 200,
    })
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario(
  'SCN-coding-acp-finish-pr: opens a PR with the exact requested title and body',
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
    given.codingCredentials({
      context: dm,
      updatedBy: alice.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
      forge: { kind: 'github', token: FORGE_TOKEN },
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectFinish(
      'pr-session',
      {
        action: 'pr',
        message: 'Create the health-check pull request',
        title: 'Add a health check',
        body: 'Adds a verified health endpoint.',
        forgeToken: FORGE_TOKEN,
      },
      { prUrl: 'https://github.com/acme/papai/pull/42' },
    )
    given.llm([
      callCapability('coding-session.finish', {
        sessionId: 'pr-session',
        action: 'pr',
        message: 'Create the health-check pull request',
        title: 'Add a health check',
        body: 'Adds a verified health endpoint.',
      }),
      answer('The health-check pull request is open.'),
    ])

    await when.message(alice, dm, 'Open the health-check pull request')

    then.replyTo(alice).equals('The health-check pull request is open.')
    expect(world.events.all().find(({ kind }) => kind === 'magi.session.finish')?.data).toEqual({
      action: 'pr',
      hasPr: true,
      sessionId: 'pr-session',
      status: 200,
    })
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario('SCN-coding-acp-cancel: cancels exactly the selected coding session', async ({ given, when, then, world }) => {
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
  magi.expectCancel('cancel-session', { id: 'cancel-session', status: 'cancelled' })
  given.llm([
    callCapability('coding-session.cancel', { sessionId: 'cancel-session' }),
    answer('The coding session was cancelled.'),
  ])

  await when.message(alice, dm, 'Cancel the coding session')

  then.replyTo(alice).equals('The coding session was cancelled.')
  expect(world.events.all().find(({ kind }) => kind === 'magi.session.cancel')?.data).toEqual({
    sessionId: 'cancel-session',
    status: 200,
  })
  expectTraceRedacted(JSON.stringify(world.events.all()))
})

scenario(
  'SCN-coding-acp-continue-followup: continues a locally known session and records its child',
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
    given.codingCredentials({
      context: dm,
      updatedBy: alice.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
      forge: { kind: 'github', token: FORGE_TOKEN },
    })
    given.knownCodingSession(dm, 'parent-session', {
      project: 'papai',
      title: 'Original health check',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectFollowUp(
      'parent-session',
      {
        prompt: 'Fix the flaky health-check test',
        contextId: coding.contextId,
        secrets: { ANTHROPIC_API_KEY: PROVIDER_KEY },
        forgeToken: FORGE_TOKEN,
      },
      {
        id: 'child-session',
        status: 'queued',
        shareToken: 'child-share',
        transcriptUrl: 'https://papai.invalid/child',
      },
    )
    given.llm([
      callCapability('coding-session.continue', {
        sessionId: 'parent-session',
        prompt: 'Fix the flaky health-check test',
      }),
      answer('The original coding session is continuing.'),
    ])

    await when.message(alice, dm, 'Continue the original coding session')

    then.replyTo(alice).equals('The original coding session is continuing.')
    then.codingSessions(dm).session('child-session').matches({
      project: 'papai',
      parentSessionId: 'parent-session',
      title: 'Fix the flaky health-check test',
    })
    expect(world.events.all().some(({ kind }) => kind === 'magi.session.follow_up')).toBe(true)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)

scenario(
  'SCN-coding-acp-continue-by-pr: follows up only the locally known matching PR session',
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
    given.codingCredentials({
      context: dm,
      updatedBy: alice.id,
      agentProvider: { agent: 'claude', provider: 'anthropic', apiKey: PROVIDER_KEY },
      forge: { kind: 'github', token: FORGE_TOKEN },
    })
    given.knownCodingSession(dm, 'local-parent', {
      project: 'papai',
      title: 'PR health check',
      createdAt: '2026-01-01T00:00:00.000Z',
      prNumber: 42,
      prUrl: 'https://github.com/acme/papai/pull/42',
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectSessions('done', [
      { id: 'foreign-parent', project: 'papai', prUrl: 'https://github.com/acme/papai/pull/42' },
      { id: 'local-parent', project: 'papai', prUrl: 'https://github.com/acme/papai/pull/42' },
    ])
    magi.expectFollowUp(
      'local-parent',
      {
        prompt: 'Address the review notes',
        contextId: coding.contextId,
        secrets: { ANTHROPIC_API_KEY: PROVIDER_KEY },
        forgeToken: FORGE_TOKEN,
      },
      { id: 'pr-child', status: 'queued' },
    )
    magi.expectSessions('done', [])
    magi.expectSessions('done', [
      { id: 'foreign-parent', project: 'papai', prUrl: 'https://github.com/acme/papai/pull/42' },
    ])
    given.llm([
      callCapability('coding-session.continue', {
        prNumber: 42,
        project: 'papai',
        prompt: 'Address the review notes',
      }),
      answer('The PR coding session is continuing.'),
      callCapability('coding-session.continue', { prNumber: 99, project: 'papai', prompt: 'Try an unknown PR' }),
      answer('No known coding session exists for PR 99.'),
      callCapability('coding-session.continue', { prNumber: 42, project: 'papai', prompt: 'Try the foreign session' }),
      answer('The foreign coding session was not continued.'),
    ])

    await when.message(alice, dm, 'Continue PR 42 and address review notes')
    await when.message(alice, dm, 'Continue PR 99')
    await when.message(alice, dm, 'Continue the foreign PR 42 session')

    then
      .repliesTo(alice)
      .equal([
        'The PR coding session is continuing.',
        'No known coding session exists for PR 99.',
        'The foreign coding session was not continued.',
      ])
    then.codingSessions(dm).session('pr-child').matches({
      project: 'papai',
      parentSessionId: 'local-parent',
      prNumber: 42,
    })
    then.codingSessions(dm).session('foreign-parent').absent()
    then.codingSessions(dm).count(2)
    expect(world.events.all().filter(({ kind }) => kind === 'magi.session.follow_up')).toHaveLength(1)
    expectTraceRedacted(JSON.stringify(world.events.all()))
  },
)
