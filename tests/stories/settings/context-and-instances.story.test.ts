// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

const BootstrapSchema = z.object({
  csrfToken: z.string(),
  principal: z.object({ isBotAdmin: z.boolean(), isSuperAdmin: z.boolean() }),
  contexts: z.array(z.object({ kind: z.string(), contextId: z.string(), label: z.string() })),
})

const AssignmentSchema = z.object({ contextId: z.string(), taskInstanceId: z.string().nullable() })

const ConfigSchema = z.object({ contextId: z.string(), fields: z.array(z.object({ key: z.string() })) })

const InstancesSchema = z.object({ instances: z.array(z.object({ id: z.string() })) })

scenario(
  'SCN-settings-bootstrap: first-run session bootstraps a fresh personal context end to end',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const memory = given.taskInstance('memory-tasks')
    const firstSession = await given.settingsSession(alice)

    const bootstrap = await when.settingsRequest(firstSession, '/settings/api/bootstrap')
    then.responseStatus(bootstrap, 200)
    const boot = BootstrapSchema.parse(await bootstrap.json())
    expect(boot.contexts.some((context) => context.kind === 'personal')).toBe(true)

    // The bootstrap GET rotates the CSRF token; re-exchange before writing.
    const session = await when.settingsSession(alice)

    const before = await when.settingsRequest(session, '/settings/api/context/task-instance')
    then.responseStatus(before, 200)
    expect(AssignmentSchema.parse(await before.json()).taskInstanceId).toBeNull()

    const assignBody = JSON.stringify({ taskInstanceId: memory.id })

    const csrfRejected = await when.settingsRequest(
      session,
      '/settings/api/context/task-instance',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: assignBody },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const assigned = await when.settingsRequest(session, '/settings/api/context/task-instance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: assignBody,
    })
    then.responseStatus(assigned, 200)

    const config = await when.settingsRequest(session, '/settings/api/config')
    then.responseStatus(config, 200)
    expect(ConfigSchema.parse(await config.json()).fields.length).toBeGreaterThan(0)

    given.llm([
      callCapability('tasks.create', { projectId: 'project-1', title: 'First task' }),
      answer('Created "First task".'),
    ])
    await when.message(alice, dm, 'Create task First task')

    then.replyTo(alice).equals('Created "First task".')
    await then.task('First task').exists()
  },
)

scenario(
  'SCN-settings-instances: an admin-created task instance becomes assignable and serves the next turn',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.taskInstance('memory-tasks')
    const admin = await given.settingsAdminSession(alice)
    const session = await when.settingsSession(alice)
    const createBody = JSON.stringify({ id: 'memory-tasks-late', type: 'kaneo', config: {} })
    const assignBody = JSON.stringify({ taskInstanceId: 'memory-tasks-late' })

    const beforeCreate = await when.settingsRequest(session, '/settings/api/context/task-instance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: assignBody,
    })
    then.responseStatus(beforeCreate, 422)

    const unauthenticated = await when.request('/settings/api/admin/task-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createBody,
    })
    then.responseStatus(unauthenticated, 401)

    const csrfRejected = await when.settingsRequest(
      admin,
      '/settings/api/admin/task-instances',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: createBody },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const created = await when.settingsRequest(admin, '/settings/api/admin/task-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createBody,
    })
    then.responseStatus(created, 201)

    const listed = await when.settingsRequest(admin, '/settings/api/admin/task-instances')
    then.responseStatus(listed, 200)
    expect(InstancesSchema.parse(await listed.json()).instances.map((instance) => instance.id)).toContain(
      'memory-tasks-late',
    )

    const assigned = await when.settingsRequest(session, '/settings/api/context/task-instance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: assignBody,
    })
    then.responseStatus(assigned, 200)

    given.llm([
      callCapability('tasks.create', { projectId: 'project-1', title: 'Late instance task' }),
      answer('Created "Late instance task".'),
    ])
    await when.message(alice, dm, 'Create task Late instance task')

    then.replyTo(alice).equals('Created "Late instance task".')
    await then.task('Late instance task').exists()
  },
)

scenario(
  'SCN-settings-context-config: tool visibility config changes what the next turn posts',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const memory = given.taskInstance('memory-tasks')
    given.assign(dm, memory)
    const session = await given.settingsSession(alice)

    given.llm([callCapability('tasks.create', { projectId: 'project-1', title: 'Quiet task' }), answer('Done one.')])
    await when.message(alice, dm, 'Create task Quiet task')
    then.replyTo(alice).equals('Done one.')
    expect(JSON.stringify(world.events.all())).not.toContain('Tool `create_task` success')

    const unknownField = await when.settingsRequest(session, '/settings/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set', key: 'bogus_field', value: 'on' }),
    })
    then.responseStatus(unknownField, 422)

    const updateBody = JSON.stringify({ action: 'set', key: 'ai_tool_visibility', value: 'on' })

    const csrfRejected = await when.settingsRequest(
      session,
      '/settings/api/config',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: updateBody },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const updated = await when.settingsRequest(session, '/settings/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: updateBody,
    })
    then.responseStatus(updated, 200)

    given.llm([callCapability('tasks.create', { projectId: 'project-1', title: 'Loud task' }), answer('Done two.')])
    await when.message(alice, dm, 'Create task Loud task')

    // With tool visibility on, the progress flush posts after the final answer
    // (llm-orchestrator-support.ts), so assert the posted reply set instead of the last reply.
    const contents = world.chat.allReplies().flatMap((reply) => (reply.content === undefined ? [] : [reply.content]))
    expect(contents).toContain('Done two.')
    expect(contents.some((content) => content.startsWith('Tool `create_task` success'))).toBe(true)
  },
)
