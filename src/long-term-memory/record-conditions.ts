// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, type SQL } from 'drizzle-orm'

import { memoryRecords } from '../db/schema.js'
import type { MemoryScope } from './types.js'

/** Matches a single memory record by id within a given scope. Shared by the record store and provisional store. */
export const recordScopeCondition = (scope: MemoryScope, recordId: string): SQL | undefined =>
  and(
    eq(memoryRecords.scopeId, scope.scopeId),
    eq(memoryRecords.scopeType, scope.scopeType),
    eq(memoryRecords.id, recordId),
  )
