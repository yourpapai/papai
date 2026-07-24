// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Task } from '../providers/types.js'
import { SNAPSHOT_FIELDS } from './snapshots.js'

/** Snapshot fields knowable from a lightweight TaskListItem-derived Task. */
export const LIGHTWEIGHT_SNAPSHOT_FIELDS: readonly string[] = ['status', 'priority', 'dueDate', 'project']

/** All snapshot fields, including those requiring full getTask enrichment. */
export const RICH_SNAPSHOT_FIELDS: readonly string[] = [...LIGHTWEIGHT_SNAPSHOT_FIELDS, 'assignee', 'labels']

const extractors = new Map(SNAPSHOT_FIELDS.map((f) => [f.field, f.extract]))

const snapshotTaskIds = (snapshots: Map<string, string>): Set<string> => {
  const ids = new Set<string>()
  for (const key of snapshots.keys()) {
    const colon = key.lastIndexOf(':')
    ids.add(colon === -1 ? key : key.slice(0, colon))
  }
  return ids
}

/**
 * True when the fetched task set or any of the given field values differs from the
 * stored snapshots. Tasks with no snapshot-able values at all keep reporting "changed"
 * (fails toward evaluation, never toward silence).
 */
export function hasTaskChanges(tasks: Task[], snapshots: Map<string, string>, fields: readonly string[]): boolean {
  const fetchedIds = new Set(tasks.map((t) => t.id))
  const storedIds = snapshotTaskIds(snapshots)
  if (fetchedIds.size !== storedIds.size) return true
  for (const id of fetchedIds) {
    if (!storedIds.has(id)) return true
  }

  for (const task of tasks) {
    for (const field of fields) {
      const extract = extractors.get(field)
      if (extract === undefined) continue
      const current = extract(task)
      const previous = snapshots.get(`${task.id}:${field}`)
      if (current === null && previous === undefined) continue
      if (current !== previous) return true
    }
  }
  return false
}
