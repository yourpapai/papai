// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario(
  'SCN-meta-search-tools: ranks tools lexically through the real search_tools tool',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const taskInstance = given.taskInstance()
    given.assign(dm, taskInstance)
    given.llm([callCapability('meta.search-tools', { query: 'create task' }), answer('You can use create_task.')])

    await when.message(alice, dm, 'How do I make a task?')

    then.replyTo(alice).equals('You can use create_task.')
    const second = world.model.inspections().at(1)
    expect(second?.promptTokenFingerprints).toContain(promptTextFingerprint('create_task'))
  },
)

scenario('SCN-meta-load-tool: loads a non-advertised tool before calling it', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const taskInstance = given.taskInstance()
  given.assign(dm, taskInstance)
  given.llm([
    callCapability('tasks.create', { projectId: 'project-1', title: 'Release 8' }),
    answer('Created “Release 8”.'),
  ])

  await when.message(alice, dm, 'Create task Release 8')

  then.replyTo(alice).equals('Created “Release 8”.')
  const [first, second] = world.model.inspections()
  expect(first?.availableTools).toContain('load_tool')
  expect(first?.availableTools).not.toContain('create_task')
  expect(second?.availableTools).toContain('create_task')
})

scenario('SCN-meta-expand-result: expands a compacted tool result by handle', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const taskInstance = given.taskInstance()
  given.assign(dm, taskInstance)
  const big = 'payload-'.repeat(1200)
  given.llm([
    callCapability('tasks.create', { projectId: 'project-1', title: 'Big task', description: big }),
    answer('Created the big task.'),
  ])

  await when.message(alice, dm, 'Create a task with a huge description')
  then.replyTo(alice).equals('Created the big task.')

  given.llm([
    callCapability('tasks.list', {}),
    callCapability('meta.expand-result', { handle: '$compaction:latest', limit: 4000 }),
    answer('The description starts with payload-payload.'),
  ])
  await when.message(alice, dm, 'Show me the big task description')

  then.replyTo(alice).equals('The description starts with payload-payload.')
  // Generation walk (turn 1: load/create/answer = 3 gens; turn 2: load/list/expand/answer = 4 gens —
  // expand_result is a meta tool and always advertised, so it needs no load_tool hop). The
  // $compaction:latest marker resolves against the compacted create_task envelope in history
  // (resolution throws when no compacted tool result was observed), and the final answer
  // generation observes the expand_result page before answering.
  const inspections = world.model.inspections()
  expect(inspections.length).toBe(7)
  const afterList = inspections.at(5)
  const answerGeneration = inspections.at(-1)
  expect(answerGeneration?.hasToolResult).toBe(true)
  expect(afterList?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('_compacted'))
  expect(answerGeneration?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('payload'))
})
