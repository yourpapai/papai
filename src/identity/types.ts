// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Methods by which an identity mapping can be established */
export type MatchMethod = 'auto' | 'manual_nl' | 'unmatched'

const MATCH_METHOD_VALUES: readonly string[] = ['auto', 'manual_nl', 'unmatched']

/**
 * Type guard to check if a value is a valid MatchMethod.
 */
export function isMatchMethod(value: string | null | undefined): value is MatchMethod {
  if (value === null || value === undefined) return false
  return MATCH_METHOD_VALUES.includes(value)
}

/** Stored identity mapping linking chat user to task tracker user */
export interface IdentityMapping {
  contextId: string
  providerName: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
  matchedAt: string
  matchMethod: MatchMethod | null
  confidence: number | null
}

/** Resolved user identity ready for use in tool calls */
export interface UserIdentity {
  userId: string
  login: string
  displayName: string
}

/** Result of identity resolution */
export type IdentityResolutionResult =
  | { type: 'found'; identity: UserIdentity }
  | { type: 'not_found'; message: string }
  | { type: 'unmatched'; message: string }
