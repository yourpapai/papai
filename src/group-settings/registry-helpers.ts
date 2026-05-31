// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  UpsertGroupAdminObservationInput,
  UpsertGroupUserObservationInput,
  UpsertKnownGroupContextInput,
} from './registry-types.js'

export const THROTTLE_MS = 5 * 60 * 1000

export function isWithinThrottleWindow(lastSeenAtIso: string): boolean {
  return Date.now() - new Date(lastSeenAtIso).getTime() < THROTTLE_MS
}

export type { UpsertGroupAdminObservationInput, UpsertGroupUserObservationInput, UpsertKnownGroupContextInput }
