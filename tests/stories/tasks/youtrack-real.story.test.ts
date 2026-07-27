// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { eq } from 'drizzle-orm'

import { YouTrackClassifiedError } from '../../../plugins/task-provider-youtrack/classify-error.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../../src/db/schema.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-youtrack-real-create: activates the real YouTrack plugin and creates a project over fake REST',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Real YouTrack' }), answer('Project created.')])

    await when.message(alice, dm, 'Create a project called Real YouTrack')
    then.replyTo(alice).equals('Project created.')
  },
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-task-youtrack-real-fields: maps YouTrack custom fields through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Fields' }), answer('Project created.')])

    await when.message(alice, dm, 'Create a project called Fields')
    then.replyTo(alice).equals('Project created.')

    const provider = await resolveRealTaskProvider(dm)
    const projects = (await provider.listProjects?.()) ?? []
    const projectId = projects[0]?.id ?? ''

    given.llm([
      callCapability('tasks.create', { projectId, title: 'Field Mapped', status: 'In Progress', priority: 'high' }),
      answer('Task created.'),
    ])
    await when.message(alice, dm, 'Create Field Mapped in progress at high priority')
    then.replyTo(alice).equals('Task created.')

    const tasks = await provider.listTasks(projectId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe('In Progress')
    expect(tasks[0]?.priority).toBe('high')
  },
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-task-youtrack-real-error: translates a YouTrack 404 into a tool failure the model can report',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
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
    // directly against the real provider instead.
    const provider = await resolveRealTaskProvider(dm)

    await expect(provider.createTask({ projectId: 'no-such-project', title: 'Doomed' })).rejects.toThrow(
      YouTrackClassifiedError,
    )

    const failure = await provider
      .createTask({ projectId: 'no-such-project', title: 'Doomed' })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(YouTrackClassifiedError)
    if (failure instanceof YouTrackClassifiedError) {
      expect(failure.appError.code).toBe('project-not-found')
    }
  },
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-task-youtrack-real-gating: skips member provisioning for a provider without members.provision',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const bob = given.user('bob')
    const group = given.group('gated-team')
    given.member(group, bob)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(group, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Gated' }), answer('Project created.')])

    await when.message(bob, group, 'Create a project called Gated')
    then.replyIn(group).equals('Project created.')

    // Positive evidence the turn genuinely exercised the real provider (not a vacuous
    // no-op): the project was actually created through the real YouTrack provider.
    const provider = await resolveRealTaskProvider(group)
    const projects = (await provider.listProjects?.()) ?? []
    expect(projects.some((project) => project.name === 'Gated')).toBe(true)

    // Positive evidence the capability gate in ensure-member.ts:217-220 is the reason no
    // row was written: this is the exact provider instance `ensureWorkspaceMember` resolves
    // for this group's config context (same `defaultTaskProviderResolver.resolve`), and it
    // lacks `members.provision`.
    expect(provider.capabilities.has('members.provision')).toBe(false)
    expect('provisionWorkspaceMember' in provider).toBe(false)

    expect(
      getDrizzleDb().select().from(kaneoWorkspaceMembers).where(eq(kaneoWorkspaceMembers.chatUserId, bob.id)).get(),
    ).toBeUndefined()
  },
  { realTaskProvider: 'youtrack' },
)
