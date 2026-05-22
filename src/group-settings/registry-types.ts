// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface UpsertKnownGroupContextInput {
  readonly contextId: string
  readonly provider: string
  readonly displayName: string
  readonly parentName: string | null
}

export interface UpsertGroupAdminObservationInput {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly isAdmin: boolean
}

export interface UpsertGroupUserObservationInput {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly displayLabel: string
}

export interface GroupUserObservation {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly displayLabel: string
}
