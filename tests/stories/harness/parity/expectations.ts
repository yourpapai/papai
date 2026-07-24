// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Aggregates the per-domain parity groups into one ordered PARITY_GROUPS.
 * Each domain module (./expectations/*.ts) declares its groups once as
 * operations-plus-assertions over the TaskProvider interface; the fake binding
 * (expectations.fake.test.ts) and tests/e2e/parity/ both iterate PARITY_GROUPS,
 * and the story catalog mints one @1 id per group's id/title. This file stays a
 * value module (it builds PARITY_GROUPS and PARITY_EXCLUSIONS) — not a re-export
 * barrel — so oxc/no-barrel-file does not fire.
 */

import { commentGroups } from './expectations/comments.js'
import { errorGroups } from './expectations/errors.js'
import { projectGroups } from './expectations/projects.js'
import { relationGroups } from './expectations/relations.js'
import { searchGroups } from './expectations/search.js'
import { taskGroups } from './expectations/tasks.js'
import type { ParityGroup } from './group.js'

export type { ParityGroup, ParityHarness } from './group.js'

export const PARITY_GROUPS: readonly ParityGroup[] = [
  ...taskGroups,
  ...searchGroups,
  ...commentGroups,
  ...relationGroups,
  ...projectGroups,
  ...errorGroups,
]

export const PARITY_EXCLUSIONS: readonly Readonly<{ group: string; reason: string }>[] = [
  {
    group: 'watchers',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no watchers counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'votes',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no votes counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'visibility',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no visibility counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'worklog',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no worklog counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'sprints',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no sprints counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'agiles',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no agiles counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'saved-queries',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no saved-queries counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'comment-reactions',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no comment-reactions counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'attachments',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no attachments counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'commands-apply',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no commands-apply counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'count-tasks',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no count-tasks counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'task-history',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no task-history counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'get-comment-single',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no get-comment-single counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'get-project-single',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no get-project-single counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'project-team',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no project-team counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'task-list-filter',
    reason:
      'Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider (plugins/task-provider-kaneo/task-status.ts validateStatus) rejects any status value that is not the exact name of an existing board column for the project — free-text tokens like "open"/"done" throw KaneoClassifiedError("status-not-found"). MemoryTaskProvider accepts any string as a status with no validation, so this group can only run against the fake; there is no status value the group could seed that both bindings would accept without changing the group itself (out of scope for Task 4).',
  },
  {
    group: 'label-crud',
    reason:
      'Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider (plugins/task-provider-kaneo/label-resource.ts) refuses to delete a label that is not attached to a task (KaneoClassifiedError("unsupported-operation")) — labels are deleted implicitly, by detaching them from their last task. MemoryTaskProvider allows deleting an unattached label outright. The group creates, updates, and removes a label without ever attaching it to a task, so its removeLabel step cannot succeed against real Kaneo as written.',
  },
  {
    group: 'status-crud',
    reason:
      "Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider's column API (plugins/task-provider-kaneo/schemas/list-tasks.ts ColumnSchema) has no order/position field on individual column create/list/update responses — column order is implicit in listColumns array position only, and the schema instead always returns a required, non-nullable isFinal boolean. MemoryTaskProvider's Column always carries a computed order and only conditionally carries isFinal. The two shapes ({id, name, order} vs {id, name, isFinal}) are structurally incompatible for a single shared exact-shape assertion.",
  },
  {
    group: 'status-reorder',
    reason:
      'Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider seeds every project with 4 default board columns (To Do, In Progress, In Review, Done) at creation; MemoryTaskProvider starts a fresh project with zero statuses. The group creates exactly 2 statuses and reorders them to absolute positions 0/1, expecting listStatuses to yield exactly those 2 names in that order — against real Kaneo the 2 new columns interleave with the 4 pre-existing defaults instead of displacing them, so the exact 2-element order assertion cannot hold for a real board.',
  },
  {
    group: 'search-invalid-workspace',
    reason:
      'KaneoProvider.searchTasks (plugins/task-provider-kaneo/provider.ts) scopes every search to a real Kaneo workspace and rejects an unknown workspace id; MemoryTaskProvider has no workspace concept and cannot reproduce the rejection, so invalid-workspace search stays a Kaneo-only residue check.',
  },
] as const
