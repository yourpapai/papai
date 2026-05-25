// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { groupUserObservations, knownGroupContexts } from '../db/schema.js'
import type {
  GroupUserObservation,
  UpsertGroupAdminObservationInput,
  UpsertGroupUserObservationInput,
  UpsertKnownGroupContextInput,
} from './registry-types.js'
import type { KnownGroupContext } from './types.js'

export const THROTTLE_MS = 5 * 60 * 1000

export function isWithinThrottleWindow(lastSeenAtIso: string): boolean {
  return Date.now() - new Date(lastSeenAtIso).getTime() < THROTTLE_MS
}

type KnownGroupContextRow = typeof knownGroupContexts.$inferSelect

export const toKnownGroupContext = (row: KnownGroupContextRow): KnownGroupContext => ({
  contextId: row.contextId,
  provider: row.provider,
  displayName: row.displayName,
  parentName: row.parentName,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
})

export const toGroupUserObservation = (
  row: Pick<
    typeof groupUserObservations.$inferSelect,
    'provider' | 'contextId' | 'userId' | 'username' | 'displayLabel'
  >,
): GroupUserObservation => ({
  provider: row.provider,
  contextId: row.contextId,
  userId: row.userId,
  username: row.username,
  displayLabel: row.displayLabel,
})

export type { UpsertGroupAdminObservationInput, UpsertGroupUserObservationInput, UpsertKnownGroupContextInput }
