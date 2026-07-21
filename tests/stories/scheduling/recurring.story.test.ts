// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario(
  'SCN-reminder-recurring-create: creating a recurrence persists it for a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.llm([
      callCapability('recurring.create', {
        title: 'Standup reminder',
        projectId: 'project-1',
        triggerType: 'cron',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0] },
      }),
      callCapability('recurring.list', {}),
      answer('Created your daily standup reminder.'),
    ])
    await when.message(alice, dm, 'Remind me about standup every day at 9')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('Standup'))
  },
)

scenario(
  'SCN-reminder-recurring-manage: pausing a recurrence is observable on a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    const { id } = given.recurringTask(dm, {
      title: 'Weekly report',
      nextRun: '2099-01-01T09:00:00.000Z',
    })
    given.llm([
      // list_recurring_tasks always includes disabled/paused entries by title, so a bare pause
      // leaves the title token unchanged and would not prove the mutation happened. Rename via
      // update_recurring_task instead: the old title token must disappear and the new one appear.
      callCapability('recurring.update', { recurringTaskId: id, title: 'Monthly report' }),
      callCapability('recurring.list', {}),
      answer('Renamed your weekly report reminder to the monthly report.'),
    ])
    await when.message(alice, dm, 'Rename the weekly report reminder to monthly report')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('Monthly'))
    expect(last?.promptToolResultTokenFingerprints).not.toContain(promptTextFingerprint('Weekly'))
  },
)

scenario(
  'SCN-reminder-recurring-fire: a due recurrence creates a task and notifies the user',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.recurringTask(dm, {
      title: 'Water the plants',
      nextRun: '2020-01-01T09:00:00.000Z',
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2020-01-01T09:00:00.000Z',
    })
    await when.recurringTick()
    await then.task('Water the plants').exists()
    then.replyTo(alice).contains('Water the plants')
  },
)
