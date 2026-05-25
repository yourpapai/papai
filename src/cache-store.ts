// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { UserCache } from './cache-types.js'

/**
 * The shared in-process user session cache store.
 * Imported by cache.ts and any satellite cache modules (e.g. cache-eviction.ts)
 * to avoid circular dependencies while sharing the same Map instance.
 */
export const userCacheStore = new Map<string, UserCache>()
