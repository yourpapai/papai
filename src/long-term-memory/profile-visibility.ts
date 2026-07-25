// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryProfile } from './types.js'

/**
 * The single gate through which profile prose may leave the store.
 *
 * Profile prose is a cache, not durable truth: it is an unstructured blend of many
 * facts, so an erased fact cannot be surgically removed from it. A purge therefore
 * stamps `contaminatedAt`, and this function withholds the whole profile until a
 * background extraction rewrites it from the surviving records.
 *
 * Fails closed by construction — every non-trustworthy state maps to `null`.
 */
export const visibleProfileText = (profile: MemoryProfile | null): string | null => {
  if (profile === null) return null
  if (profile.contaminatedAt !== null) return null
  const text = profile.profile.trim()
  return text === '' ? null : profile.profile
}
