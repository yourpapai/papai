// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShapeKey } from './registry.js'

/** Declared cells for the capture-idempotency criterion. Read by the suite AND by coverage.ts. */
export const CASES: Partial<Record<ShapeKey, string>> = {
  'duplicate-out-of-order': 'identical content hashes identically regardless of arrival order or spacing',
  contradiction: 'a superseded record is retained as contradicted while its replacement is active',
}
