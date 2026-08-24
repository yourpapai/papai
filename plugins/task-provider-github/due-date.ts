// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ListTasksParams } from 'papai/plugin-types'

/**
 * GitHub Issues have no due dates, so the normalized due-date input collapses
 * to undefined: callers accept the field and ignore it (see the prompt
 * addendum), and nothing is ever sent upstream.
 */
export const normalizeGitHubDueDateInput = (
  _dueDate: Readonly<{ date: string; time?: string }> | undefined,
): string | undefined => undefined

/** No date filters map onto GitHub Issues; list params pass through unchanged. */
export const normalizeGitHubListTaskParams = (params: Readonly<ListTasksParams>): ListTasksParams => ({
  ...params,
})
