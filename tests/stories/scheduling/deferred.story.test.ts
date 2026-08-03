// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

const CHAT_COMPLETIONS = 'https://llm.invalid/v1/chat/completions'

scenario(
  'SCN-deferred-schedule-create: scheduling a prompt persists it for a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.llm([
      callCapability('deferred.create', {
        prompt: 'Tell me to submit the report',
        schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
        execution: {
          mode: 'lightweight',
          delivery_brief: 'remind about the report',
        },
      }),
      callCapability('deferred.list', {}),
      answer('Scheduled your report reminder for Jan 1.'),
    ])
    await when.message(alice, dm, 'Remind me on Jan 1 to submit the report')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('report'))
  },
)

scenario(
  'SCN-deferred-alert-create: creating a task-condition alert persists it for a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.llm([
      callCapability('deferred.create', {
        prompt: 'Nudge me about overdue tasks',
        condition: { field: 'task.dueDate', op: 'overdue' },
        execution: {
          mode: 'lightweight',
          delivery_brief: 'nudge about overdue work',
        },
      }),
      callCapability('deferred.list', {}),
      answer('I will alert you when a task goes overdue.'),
    ])
    await when.message(alice, dm, 'Alert me when a task is overdue')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('overdue'))
  },
)

scenario(
  'SCN-deferred-manage: cancelling a scheduled prompt is observable on a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const { id } = given.scheduledPrompt(dm, {
      prompt: 'Submit the report',
      fireAt: '2099-01-01T09:00:00.000Z',
    })
    given.llm([
      // list_reminders applies no status filter when none is given, so a cancelled
      // prompt's title text keeps appearing in the default list — it never disappears. The
      // mutation is observable via the status field instead: 'cancelled' appears in both the
      // cancel result and the following list entry, and because this turn never lists before
      // cancelling, the prior 'active' status token never appears anywhere in the turn at all.
      callCapability('deferred.cancel', { id }),
      callCapability('deferred.list', {}),
      answer('Cancelled your report reminder.'),
    ])
    await when.message(alice, dm, 'Cancel the report reminder')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('cancelled'))
    expect(last?.promptToolResultTokenFingerprints).not.toContain(promptTextFingerprint('active'))
  },
)

scenario(
  'SCN-deferred-fire-scheduled: a due scheduled prompt delivers a proactive message',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    world.http.expect({ method: 'POST', url: CHAT_COMPLETIONS }, () =>
      Response.json({
        id: 'chatcmpl-fire-sched',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Time to submit the report.',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    )
    given.scheduledPrompt(dm, {
      prompt: 'Submit the report',
      fireAt: '2020-01-01T09:00:00.000Z',
    })
    await when.scheduledPoll()
    then.replyTo(alice).contains('submit the report')
  },
)

scenario('SCN-deferred-fire-alert: an overdue task fires a proactive alert', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.assign(dm, given.taskInstance())
  // fetchAllTasks only preserves dueDate on the fetchViaProjects path (requires the
  // 'projects.list' capability plus a registered project); the fetchViaSearch fallback drops
  // dueDate entirely, which would make the 'overdue' condition never match.
  given.taskCapabilities(['projects.list'])
  const project = await world.tasks.createProject({ name: 'Board' })
  await world.tasks.createTask({
    projectId: project.id,
    title: 'Overdue task',
    dueDate: '2020-01-01',
  })
  world.http.expect({ method: 'POST', url: CHAT_COMPLETIONS }, () =>
    Response.json({
      id: 'chatcmpl-fire-alert',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Heads up: a task is overdue.',
          },
          finish_reason: 'stop',
        },
      ],
    }),
  )
  given.alertPrompt(dm, {
    prompt: 'Nudge me about overdue tasks',
    condition: { field: 'task.dueDate', op: 'overdue' },
  })
  await when.alertPoll()
  then.replyTo(alice).contains('overdue')
})
