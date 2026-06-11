// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getMainContextIdFromThreadContextId } from '../chat/scoped-context.js'
import type { ContextType } from '../chat/types.js'
import type { MemoryScope } from './types.js'

export type ResolveMemoryScopeInput = Readonly<{
  storageContextId: string
  contextType: ContextType
}>

export function resolveMemoryScope(input: ResolveMemoryScopeInput): MemoryScope {
  if (input.contextType === 'dm') {
    return { scopeId: input.storageContextId, scopeType: 'personal' }
  }
  return {
    scopeId: getMainContextIdFromThreadContextId(input.storageContextId),
    scopeType: 'group',
  }
}
