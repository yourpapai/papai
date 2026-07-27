// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-youtrack-real-create: activates the real YouTrack plugin and creates a task over fake REST',
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
