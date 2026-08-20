// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Shown when the context has no task instance bound at all. */
export const UNASSIGNED_PLACEHOLDER = 'Not yet assigned — select an instance'
/** Shown when the context is bound to an instance that is gone or no longer active. */
export const UNAVAILABLE_PLACEHOLDER = 'Assigned instance is unavailable — select another'

export interface TaskInstanceSelection {
  /** The `Select` value; `''` means nothing is chosen. */
  selected: string
  /** Placeholder copy for the empty state; `''` renders no placeholder option. */
  placeholder: string
}

/**
 * Resolve which task-instance option a context's `Select` should show.
 *
 * Both provider sections previously fell back to `available[0]`, making "not yet
 * configured" pixel-identical to "bound to the first instance" — an admin could
 * read an unset context as already routed. Leaving the control empty makes the
 * unset state visible in the control itself, not just in adjacent copy.
 */
export function resolveTaskInstanceSelection(
  taskInstanceId: string | null,
  available: readonly { id: string }[],
): TaskInstanceSelection {
  if (taskInstanceId !== null && available.some((option) => option.id === taskInstanceId)) {
    return { selected: taskInstanceId, placeholder: '' }
  }
  return {
    selected: '',
    placeholder: taskInstanceId === null ? UNASSIGNED_PLACEHOLDER : UNAVAILABLE_PLACEHOLDER,
  }
}
