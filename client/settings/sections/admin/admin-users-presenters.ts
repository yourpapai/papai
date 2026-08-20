// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Ids the server issues for a user who has not messaged the bot yet carry this prefix. */
const PENDING_PREFIX = 'placeholder-'

export type UserStatus = 'active' | 'blocked' | 'pending'

export function userStatus(input: { userId: string; blocked: boolean }): UserStatus {
  if (input.blocked) return 'blocked'
  return input.userId.startsWith(PENDING_PREFIX) ? 'pending' : 'active'
}

/**
 * How a user came to be authorized. The column is an open set: the server writes
 * two literal provenance markers, and otherwise the platform user id of the admin
 * who added the row.
 */
export type AddedBy = { kind: 'label'; text: string } | { kind: 'id'; value: string } | { kind: 'none' }

const ADDED_BY_LABELS: Record<string, string> = {
  'open-access': 'Open access',
  'announce-subscription': 'Announcement signup',
}

export function describeAddedBy(raw: string): AddedBy {
  if (raw === '') return { kind: 'none' }
  const label = ADDED_BY_LABELS[raw]
  if (label !== undefined) return { kind: 'label', text: label }
  return { kind: 'id', value: raw }
}

/** Name the subject of the remove confirmation as a person wherever the data allows. */
export function removeUserLabel(input: { username: string; userId: string }): string {
  const hasName = input.username !== '' && input.username !== '—'
  const pending = input.userId.startsWith(PENDING_PREFIX)
  if (hasName && !pending) return `${input.username} (${input.userId})`
  if (hasName) return `${input.username} (pending)`
  if (!pending) return input.userId
  return 'this pending user'
}
