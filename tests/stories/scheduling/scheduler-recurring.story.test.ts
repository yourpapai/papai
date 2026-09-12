// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'

scenario(
  'SCN-scheduler-recurring-fire: the real scheduler processes a due recurring task',
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

    await when.startScheduler()

    await then.task('Water the plants').exists()
    then.replyTo(alice).contains('Water the plants')
  },
)
