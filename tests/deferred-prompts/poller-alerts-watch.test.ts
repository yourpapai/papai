// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { createAlertPrompt, getAlertPrompt } from '../../src/deferred-prompts/alerts.js'
import { LIGHTWEIGHT_SNAPSHOT_FIELDS, RICH_SNAPSHOT_FIELDS } from '../../src/deferred-prompts/change-gate.js'
import { collectPureWatchFiring, watchTaskChanged } from '../../src/deferred-prompts/poller-alerts-watch.js'
import { TRACKED_FIELDS_ROW } from '../../src/deferred-prompts/snapshots.js'
import type { Task } from '../../src/providers/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  url: `http://test/${id}`,
  status: 'todo',
  ...overrides,
})

const snapshotsFrom = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries))

describe('watchTaskChanged', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('reports unchanged for a task with no stored snapshot (baseline sighting)', () => {
    expect(watchTaskChanged(makeTask('t1'), snapshotsFrom({}))).toBe(false)
  })

  test('reports changed when a snapshot-visible field differs', () => {
    const snapshots = snapshotsFrom({ 't1:status': 'todo' })
    expect(watchTaskChanged(makeTask('t1', { status: 'done' }), snapshots)).toBe(true)
  })

  test('reports unchanged when every snapshot-visible field matches', () => {
    const snapshots = snapshotsFrom({ 't1:status': 'todo', 't1:priority': 'high' })
    expect(watchTaskChanged(makeTask('t1', { status: 'todo', priority: 'high' }), snapshots)).toBe(false)
  })

  test('treats a null current value with no stored entry as unchanged', () => {
    const snapshots = snapshotsFrom({ 't1:status': 'todo' })
    expect(watchTaskChanged(makeTask('t1', { status: 'todo', dueDate: null }), snapshots)).toBe(false)
  })

  test('reports changed when a rich field (assignee) differs', () => {
    const snapshots = snapshotsFrom({ 't1:status': 'todo', 't1:assignee': 'alice' })
    expect(watchTaskChanged(makeTask('t1', { status: 'todo', assignee: 'bob' }), snapshots)).toBe(true)
  })

  test('restricted to lightweight fields ignores rich-field drift against stored snapshots', () => {
    const snapshots = snapshotsFrom({ 't1:status': 'todo', 't1:assignee': 'alice' })
    const unenrichedTask = makeTask('t1', { status: 'todo' })
    expect(watchTaskChanged(unenrichedTask, snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(false)
    expect(watchTaskChanged(unenrichedTask, snapshots, RICH_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('treats a rich field outside the last write tracked set as no baseline, not a change', () => {
    const snapshots = snapshotsFrom({
      't1:status': 'todo',
      [`t1:${TRACKED_FIELDS_ROW}`]: LIGHTWEIGHT_SNAPSHOT_FIELDS.join(','),
    })
    const task = makeTask('t1', { status: 'todo', assignee: 'alice', labels: [{ id: 'l1', name: 'bug' }] })
    expect(watchTaskChanged(task, snapshots, RICH_SNAPSHOT_FIELDS)).toBe(false)
  })

  test('reports changed when a tracked field gains a value from null (row absent)', () => {
    const snapshots = snapshotsFrom({
      't1:status': 'todo',
      [`t1:${TRACKED_FIELDS_ROW}`]: RICH_SNAPSHOT_FIELDS.join(','),
    })
    expect(watchTaskChanged(makeTask('t1', { status: 'todo', assignee: 'alice' }), snapshots)).toBe(true)
  })

  test('treats a tracked null field with no stored row as unchanged', () => {
    const snapshots = snapshotsFrom({
      't1:status': 'todo',
      [`t1:${TRACKED_FIELDS_ROW}`]: RICH_SNAPSHOT_FIELDS.join(','),
    })
    expect(watchTaskChanged(makeTask('t1', { status: 'todo', labels: [] }), snapshots)).toBe(false)
  })

  test('a task whose only stored row is the tracked-fields marker is a baseline sighting', () => {
    const snapshots = snapshotsFrom({ [`t1:${TRACKED_FIELDS_ROW}`]: RICH_SNAPSHOT_FIELDS.join(',') })
    expect(watchTaskChanged(makeTask('t1', { status: 'todo', assignee: 'alice' }), snapshots)).toBe(false)
  })
})

describe('collectPureWatchFiring', () => {
  const USER = 'watch-unit-user'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  const makeWatchAlert = (): ReturnType<typeof createAlertPrompt> =>
    createAlertPrompt(USER, 'Notify on change', { field: 'task.id', op: 'eq', value: 't1' })

  test('fires when the matched watched task has a snapshot-visible change', () => {
    const alert = makeWatchAlert()
    const snapshots = snapshotsFrom({ 't1:status': 'todo' })
    const tasks = [makeTask('t1', { status: 'done' })]

    const firing = collectPureWatchFiring([alert], tasks, snapshots, new Date())

    expect(firing).toHaveLength(1)
    expect(firing[0]!.alert.id).toBe(alert.id)
    expect(firing[0]!.newMatchedTasks.map((t) => t.id)).toEqual(['t1'])
  })

  test('keeps matched-set bookkeeping and does not fire on a baseline sighting', () => {
    const alert = makeWatchAlert()
    const snapshots = snapshotsFrom({})
    const tasks = [makeTask('t1')]

    const firing = collectPureWatchFiring([alert], tasks, snapshots, new Date())

    expect(firing).toHaveLength(0)
    expect(getAlertPrompt(alert.id, USER)!.matchedTaskIds).toEqual(['t1'])
  })

  test('does not fire when the changed task is not matched by the condition', () => {
    const alert = makeWatchAlert()
    const snapshots = snapshotsFrom({ 't2:status': 'todo' })
    const tasks = [makeTask('t2', { status: 'done' })]

    const firing = collectPureWatchFiring([alert], tasks, snapshots, new Date())

    expect(firing).toHaveLength(0)
  })
})
