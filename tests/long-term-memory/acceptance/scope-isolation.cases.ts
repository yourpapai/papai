// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShapeKey } from './registry.js'

/** Declared cells for the scope-isolation criterion. Read by the suite AND by coverage.ts. */
export const CASES: Partial<Record<ShapeKey, string>> = {
  multilingual: 'bilingual records in one personal scope never surface in another',
  'multi-party': 'personal, group, and thread-scoped records stay in their own scope',
}
