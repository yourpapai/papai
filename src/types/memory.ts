// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Memory-related types shared across the application.
 */

export type MemoryFact = {
  readonly identifier: string
  readonly title: string
  readonly url: string
  readonly last_seen: string
}
