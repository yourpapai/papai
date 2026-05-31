// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type KnownGroupContext = {
  readonly contextId: string
  readonly provider: string
  readonly displayName: string
  readonly parentName: string | null
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly source?: 'observed' | 'authorized-fallback'
}
