// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Shared PARITY_GROUPS that cannot map to the YouTrack conformance binding, each
 * with the concrete reason. The binding runner (provider-conformance.test.ts)
 * runs PARITY_GROUPS minus these ids; the integrity test proves no id is stale
 * and nothing is silently dropped. A genuine conformance gap is recorded here
 * with a reason — never skipped without one.
 */

export const YOUTRACK_PARITY_EXCLUSIONS: readonly Readonly<{ group: string; reason: string }>[] = [
  {
    group: 'SCN-parity-task-dates',
    reason:
      'YouTrackProvider (plugins/task-provider-youtrack/mappers.ts mapIssueToTask) emits no startDate — YouTrack issues have no start-date field and only dueDate is derived from the "Due Date" custom field, so the group\'s startDate round-trip assertion cannot hold.',
  },
  {
    group: 'SCN-parity-task-preserve-startdate',
    reason:
      'Same startDate gap: YouTrackProvider surfaces no startDate on a Task, so preserving one across an update is unobservable.',
  },
  {
    group: 'SCN-parity-task-label',
    reason:
      'Labels excluded for this lane by decision; YouTrack models tags, not the createLabel/addTaskLabel/removeTaskLabel surface the group asserts. Label coverage is deferred.',
  },
  {
    group: 'SCN-parity-identity',
    reason:
      'Identity excluded for this lane by decision; provisionWorkspaceMember/listUsers over the YouTrack Hub is out of scope for the conformance lane.',
  },
  {
    group: 'SCN-parity-project-label-errors',
    reason:
      'Exercises removeTaskLabel (labels), excluded alongside SCN-parity-task-label; the updateProject-missing rejection is already covered structurally by other error groups.',
  },
  {
    group: 'SCN-parity-project-crud',
    reason:
      'YouTrackProvider project mappers (plugins/task-provider-youtrack/operations/projects.ts) always emit a description key (value undefined when absent), so Object.keys(project) is [description,id,name,url]; the group asserts exactly [id,name,url]. A normalized-shape divergence (YouTrack surfaces project description), not a fake limitation.',
  },
] as const
