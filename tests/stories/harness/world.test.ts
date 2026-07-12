// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { getActivatedPluginIds } from '../../../src/plugins/loader.js'
import { toolCapabilityCatalog } from '../../../src/runtime/capability-catalog.js'
import { answer } from './scripted-llm.js'
import { createScenarioWorld } from './world.js'

describe('scenario world', () => {
  test('composes the real runtime path with deterministic scenario boundaries', async () => {
    const world = await createScenarioWorld('real runtime path')

    try {
      expect(world.clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
      expect(world.ids.next('probe')).toBe('probe-1')

      const alice = world.api.given.user('alice')
      const dm = world.api.given.dm(alice)
      world.api.given.llm([answer('Hello Alice')])

      await world.api.when.message(alice, dm, 'hello')

      world.api.then.replyTo(alice).equals('Hello Alice')
      expect(world.model.inspections()).toHaveLength(1)
      world.verify()
    } finally {
      await world.stop()
    }
  })

  test('creates sequential worlds without leaking database, tasks, replies, plugins, capabilities, or ids', async () => {
    expect(getActivatedPluginIds()).toEqual([])
    const first = await createScenarioWorld('first')
    const firstDatabase = getDrizzleDb()

    expect(first.ids.next('probe')).toBe('probe-1')
    await first.tasks.createTask({ projectId: 'project-1', title: 'First task' })
    first.events.record('scenario.first', {})
    await first.stop()

    expect(getActivatedPluginIds()).toEqual([])
    expect(toolCapabilityCatalog.entries()).toEqual([])

    const second = await createScenarioWorld('second')
    try {
      expect(getDrizzleDb()).not.toBe(firstDatabase)
      expect(second.chat.allReplies()).toEqual([])
      expect(second.events.all()).toEqual(second.startupEvents)
      expect(await second.tasks.searchTasks({ query: '' })).toEqual([])
      expect(getActivatedPluginIds()).toEqual([])
      expect(toolCapabilityCatalog.entries()).toEqual(second.capabilityEntriesAtStart)
      expect(second.ids.next('probe')).toBe('probe-1')
    } finally {
      await second.stop()
    }

    expect(getActivatedPluginIds()).toEqual([])
    expect(toolCapabilityCatalog.entries()).toEqual([])
  })

  test('stop is concurrent-safe and idempotent', async () => {
    const world = await createScenarioWorld('idempotent stop')

    await Promise.all([world.stop(), world.stop()])
    await world.stop()

    expect(world.events.all().filter(({ kind }) => kind === 'world.cleanup.runtime.stop')).toHaveLength(1)
  })
})
