// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryScope } from '../../long-term-memory/types.js'

/** Convert a resolved settings context scope into the storage-layer MemoryScope shape. */
export const toMemoryScope = (scope: {
  readonly contextId: string
  readonly kind: 'personal' | 'group'
}): MemoryScope => ({
  scopeId: scope.contextId,
  scopeType: scope.kind,
})
