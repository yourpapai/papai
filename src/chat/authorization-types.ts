// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Reason an authorization check denied a message. */
export type AuthorizationDenyReason =
  | 'group_not_allowed'
  | 'group_member_not_allowed'
  | 'dm_not_allowed'
  | 'user_blocked'

/** Effective actor role for a turn: a restricted group guest vs. a normal member/admin/user. */
export type ActorRole = 'guest' | 'member'

/** Authorization result for message processing. */
export type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
  // `configCommandAllowed`: set on an otherwise-denied DM result when the user can
  // manage a group; lets the launcher-only `/config` command through without
  // granting general DM access.
} & Partial<{
  configContextId: string
  reason: AuthorizationDenyReason
  configCommandAllowed: boolean
  isGuest: boolean
}>
