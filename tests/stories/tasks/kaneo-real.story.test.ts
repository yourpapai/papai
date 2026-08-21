// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { eq } from 'drizzle-orm'

import { KaneoClassifiedError } from '../../../plugins/task-provider-kaneo/classify-error.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../../src/db/schema.js'
import { waitFor } from '../../utils/test-helpers.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-kaneo-real-create: activates the real Kaneo plugin and creates a project over fake REST',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'kaneo')
    given.assign(dm, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Real Kaneo' }), answer('Project created.')])

    await when.message(alice, dm, 'Create a project called Real Kaneo')
    then.replyTo(alice).equals('Project created.')

    // Positive evidence the project was created through the real Kaneo provider, not a
    // vacuous text-only pass: resolve the provider and read the project back.
    const provider = await resolveRealTaskProvider(dm)
    const projects = (await provider.listProjects?.()) ?? []
    expect(projects.some((project) => project.name === 'Real Kaneo')).toBe(true)
  },
  { realTaskProvider: 'kaneo' },
)

scenario(
  'SCN-task-kaneo-real-fields: maps task status and priority fields through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'kaneo')
    given.assign(dm, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Fields' }), answer('Project created.')])

    await when.message(alice, dm, 'Create a project called Fields')
    then.replyTo(alice).equals('Project created.')

    const provider = await resolveRealTaskProvider(dm)
    const projects = (await provider.listProjects?.()) ?? []
    const projectId = projects[0]?.id ?? ''

    given.llm([
      callCapability('tasks.create', { projectId, title: 'Field Mapped', status: 'to-do', priority: 'high' }),
      answer('Task created.'),
    ])
    await when.message(alice, dm, 'Create Field Mapped at to-do status and high priority')
    then.replyTo(alice).equals('Task created.')

    const tasks = await provider.listTasks(projectId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe('to-do')
    expect(tasks[0]?.priority).toBe('high')
  },
  { realTaskProvider: 'kaneo' },
)

scenario(
  'SCN-task-kaneo-real-error: translates a Kaneo 404 into a tool failure the model can report',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'kaneo')
    given.assign(dm, instance)
    given.llm([
      callCapability('tasks.create', { projectId: 'no-such-project', title: 'Doomed' }),
      answer('That project does not exist.'),
      answer('That project does not exist.'),
    ])

    await when.message(alice, dm, 'Create Doomed in project no-such-project')
    then.replyTo(alice).equals('That project does not exist.')

    // The harness `then` surface has no accessor for recorded tool results (see
    // tests/stories/harness/scenario.ts:287-295), so assert on the classified error
    // directly against the real provider instead. createTask validates the status
    // against the project's columns first (task-resource.ts validateStatus →
    // listColumns GET /column/:projectId); for a missing project that route 404s and
    // the classifier keys on the 'project' substring in the request path/message,
    // yielding `project-not-found`. The POST /task/:projectId route is never reached,
    // so the result is `project-not-found` (also the more accurate code: the project
    // is the missing resource), not the `task-not-found` a bare POST /task/ 404 would
    // produce. See task-6-report.md for the discrepancy against the brief.
    const provider = await resolveRealTaskProvider(dm)

    await expect(provider.createTask({ projectId: 'no-such-project', title: 'Doomed' })).rejects.toThrow(
      KaneoClassifiedError,
    )

    const failure = await provider
      .createTask({ projectId: 'no-such-project', title: 'Doomed' })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(KaneoClassifiedError)
    if (failure instanceof KaneoClassifiedError) {
      expect(failure.appError.code).toBe('project-not-found')
    }
  },
  { realTaskProvider: 'kaneo' },
)

scenario(
  'SCN-task-kaneo-real-gating: provisions a workspace member for a provider with members.provision',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const bob = given.user('bob')
    const group = given.group('provision-team')
    given.member(group, bob)
    const instance = given.taskInstance(undefined, 'kaneo')
    given.assign(group, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Provisioned' }), answer('Project created.')])

    await when.message(bob, group, 'Create a project called Provisioned')
    then.replyIn(group).equals('Project created.')

    // Positive evidence the turn genuinely exercised the real Kaneo provider (not a vacuous
    // no-op): members.provision is advertised and the provider implements it.
    const provider = await resolveRealTaskProvider(group)
    expect(provider.capabilities.has('members.provision')).toBe(true)
    expect('provisionWorkspaceMember' in provider).toBe(true)

    // The group-membership backstop (llm-orchestrator.ts maybeEnsureGroupMembership) is
    // fire-and-forget, so poll for the persisted kaneoWorkspaceMembers row rather than
    // assuming it lands before when.message returns. A row is written on both success
    // ('active') and failure ('failed'); assert the active outcome so a silent provision
    // error cannot pass as a successful provisioning proof.
    await waitFor(
      () =>
        getDrizzleDb()
          .select()
          .from(kaneoWorkspaceMembers)
          .where(eq(kaneoWorkspaceMembers.chatUserId, bob.id))
          .get() !== undefined,
    )
    const row = getDrizzleDb()
      .select()
      .from(kaneoWorkspaceMembers)
      .where(eq(kaneoWorkspaceMembers.chatUserId, bob.id))
      .get()
    expect(row).toBeDefined()
    expect(row?.status).toBe('active')
  },
  { realTaskProvider: 'kaneo' },
)
