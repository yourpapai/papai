// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Friendly names for the provider types the codebase knows; mirrors src/debug/settings/task-instance-options.ts. */
const TYPE_LABELS: Record<string, string> = { kaneo: 'Kaneo', youtrack: 'YouTrack' }

export interface TaskInstanceOptionInput {
  id: string
  type: string
  status: string
  name?: string
}

/**
 * Select option for a task instance.
 *
 * The server always populates `name` (src/debug/settings/task-instance-options.ts),
 * so the fallback here should be unreachable in production. It is kept
 * deliberately: `TaskInstanceOptionSchema.name` stays optional because a strict
 * schema would turn one unlabeled instance into a failed fetch that blanks the
 * whole section, and showing an id beats showing nothing. The fallback also runs
 * for real in Storybook, where MSW replaces the server entirely.
 */
export function formatTaskInstanceOption(option: TaskInstanceOptionInput): { value: string; label: string } {
  const name =
    option.name !== undefined && option.name !== ''
      ? option.name
      : `${TYPE_LABELS[option.type] ?? option.type} instance (${option.id})`
  return { value: option.id, label: `${name} (${option.type} · ${option.status})` }
}
