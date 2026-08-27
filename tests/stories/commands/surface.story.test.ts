// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { configureCodingSessionCapability } from '../../../src/coding-sessions/configure.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability, gateCall, promptTextFingerprint } from '../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-commands-surface-magi-token'
const ACP_COMMAND = '/plugin_acp_acp'
const ACP_COMMAND_REPLY =
  'ACP coding sessions are available. Ask me in natural language, e.g. "start a session on demo to add a ' +
  'health check", "what sessions are running?", "review PR 42 on demo", or "continue PR 42 on demo and fix ' +
  'the failing tests".'
const ACP_DISABLED_REPLY = 'Plugin `acp` is disabled for this context.'
const SETTINGS_BASE_URL = 'https://settings.invalid'

scenario('SCN-cmd-help: shows user help and the admin appendix', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const bob = given.user('bob')
  given.admin(bob)
  const bobDm = given.dm(bob)

  await when.message(alice, dm, '/help')
  then
    .replyTo(alice)
    .equals(
      [
        'papai — AI assistant for Kaneo task management',
        '',
        'Commands:',
        '/help — Show this message',
        '/config — Open your settings in the web UI (single-use link)',
        '/clear — Clear conversation history and memory',
        '/context — Show current memory context (summary and known entities)',
        '/stop — Stop or steer the running task (send again to stop immediately)',
        '',
        'Any other message is sent to the AI assistant.',
      ].join('\n'),
    )

  await when.message(bob, bobDm, '/help')
  then.replyTo(bob).contains('Admin commands:')
  then.replyTo(bob).contains('/dashboard — Open the operator dashboard (single-use link)')
})

scenario('SCN-cmd-start: welcomes an authorized user', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)

  await when.message(alice, dm, '/start')

  then.replyTo(alice).contains('Welcome to papai!')
  then.replyTo(alice).contains('/config')
})

scenario('SCN-cmd-config-dm: issues a single-use settings link in DM', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.publicBaseUrl(SETTINGS_BASE_URL)
  await when.message(alice, dm, '/config')

  then.replyTo(alice).contains('Open your settings:')
  then.replyTo(alice).contains(SETTINGS_BASE_URL)
  then.replyTo(alice).contains('single-use and expires in 10 minutes')
})

scenario('SCN-cmd-config-group: redirects group admins and refuses plain members', async ({ given, when, then }) => {
  const carol = given.user('carol')
  const dave = given.user('dave')
  const team = given.group('team')
  given.member(team, carol)
  given.member(team, dave)
  given.groupAdmin(team, carol)

  await when.message(carol, team, '/config')
  then
    .replyIn(team)
    .equals('Group settings are configured in direct messages with the bot. Open a DM with me and run /config.')

  await when.message(dave, team, '/config')
  then
    .replyIn(team)
    .equals(
      'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
    )
})

scenario('SCN-cmd-context: renders the memory context snapshot', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.identity(alice, { providerUserId: 'alice-kaneo', login: 'alice', displayName: 'Alice' })

  await when.message(alice, dm, '/context')

  then.replyTo(alice).contains('"modelName":"scenario-main-model"')
  then.replyTo(alice).contains('"label":"Memory context"')
  then.replyTo(alice).contains('"detail":"0 facts"')
})

scenario('SCN-cmd-clear-self: clears own history, memory, and facts', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([answer('first reply')])

  await when.message(alice, dm, 'remember this phrase')
  then.replyTo(alice).equals('first reply')

  await when.message(alice, dm, '/clear')
  then.replyTo(alice).equals('Conversation history, memory, and facts cleared.')

  given.llm([answer('second reply')])
  await when.message(alice, dm, 'hello again')
  then.replyTo(alice).equals('second reply')
  const last = world.model.inspections().at(-1)
  expect(last?.promptTextFingerprints).not.toContain(promptTextFingerprint('remember this phrase'))
})

scenario('SCN-cmd-clear-target-user: an admin clears another user', async ({ given, when, then }) => {
  given.user('alice')
  const bob = given.user('bob')
  given.admin(bob)
  const bobDm = given.dm(bob)

  await when.message(bob, bobDm, '/clear alice')

  then.replyTo(bob).equals('Cleared history, memory, and facts for user alice.')
})

scenario('SCN-cmd-clear-all: a super admin clears every user', async ({ given, when, then }) => {
  given.user('alice')
  const bob = given.user('bob')
  given.admin(bob, { superAdmin: true })
  const bobDm = given.dm(bob)

  await when.message(bob, bobDm, '/clear all')

  then.replyTo(bob).equals('Cleared history, memory, and facts for all 2 users.')
})

scenario('SCN-cmd-clear-group-denied: a plain group member cannot clear', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const team = given.group('team')
  given.member(team, alice)

  await when.message(alice, team, '/clear')

  then.replyIn(team).equals('Only group admins can run this command.')
})

scenario('SCN-cmd-dashboard: reports the dashboard disabled without DEBUG_SERVER', async ({ given, when, then }) => {
  const bob = given.user('bob')
  given.admin(bob)
  const bobDm = given.dm(bob)
  const team = given.group('team')
  given.member(team, bob)

  await when.message(bob, bobDm, '/dashboard')
  then.replyTo(bob).equals('The dashboard is disabled on this deployment (DEBUG_SERVER is not enabled).')

  await when.message(bob, team, '/dashboard')
  then.replyIn(team).equals('Open this in a DM with me — `/dashboard` is DM-only.')
})

scenario('SCN-cmd-stop-noop: reports nothing running', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)

  await when.message(alice, dm, '/stop')

  then.replyTo(alice).equals('Nothing is running right now.')
})

scenario(
  'SCN-cmd-acp: shows ACP help in an eligible context and refuses a disabled one',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const aliceDm = given.dm(alice)
    const bobDm = given.dm(bob)
    const aliceContextId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: alice.id,
    })
    given.runtimeExtension({
      async start({ record }): Promise<void> {
        await configureCodingSessionCapability({
          pluginDirectory: 'plugins',
          contextId: aliceContextId,
          magiBaseUrl: MAGI_URL,
          magiToken: MAGI_TOKEN,
          updatedBy: alice.id,
        })
        record('scenario.runtime-extension.configured', { contribution: 'command', context: 'alice' })
      },
    })

    await when.message(alice, aliceDm, ACP_COMMAND)
    then.replyTo(alice).equals(ACP_COMMAND_REPLY)

    await when.message(bob, bobDm, ACP_COMMAND)
    then.replyTo(bob).equals(ACP_DISABLED_REPLY)
  },
)

scenario(
  'SCN-cmd-stop-graceful: first stop winds down after the current step',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const taskInstance = given.taskInstance()
    given.assign(dm, taskInstance)
    given.llm([
      callCapability('tasks.create', { projectId: 'project-1', title: 'Long task' }),
      gateCall('tasks.create', { projectId: 'project-1', title: 'Another long task' }),
      answer('Created both long tasks.'),
    ])

    const gatePromise = world.model.nextGate()
    await when.dispatchMessage(alice, dm, 'Create a long task')
    const gate = await gatePromise

    await when.dispatchMessage(alice, dm, '/stop')
    then.replyTo(alice).equals('🛑 winding down after this step…')

    gate.release()
    await world.settle()

    then
      .repliesTo(alice)
      .equal([
        '🛑 winding down after this step…',
        'Created both long tasks.',
        '🛑 Stopped. Completed 3 actions: load_tool, create_task ×2.',
      ])
  },
)

scenario('SCN-cmd-stop-abort: second stop aborts immediately', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const taskInstance = given.taskInstance()
  given.assign(dm, taskInstance)
  given.llm([
    callCapability('tasks.create', { projectId: 'project-1', title: 'Long task' }),
    gateCall('tasks.create', { projectId: 'project-1', title: 'Another long task' }),
  ])

  const gatePromise = world.model.nextGate()
  await when.dispatchMessage(alice, dm, 'Create a long task')
  await gatePromise

  await when.dispatchMessage(alice, dm, '/stop')
  await when.dispatchMessage(alice, dm, '/stop')
  then.repliesTo(alice).equal(['🛑 winding down after this step…', '🛑 Stopping immediately…'])

  await world.settle()

  then
    .repliesTo(alice)
    .equal([
      '🛑 winding down after this step…',
      '🛑 Stopping immediately…',
      '🛑 Stopped immediately. Completed 2 actions: load_tool, create_task. An in-flight action may have been cut ' +
        'off — verify recent changes.',
    ])
})
