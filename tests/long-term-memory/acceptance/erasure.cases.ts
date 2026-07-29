// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShapeKey } from './registry.js'

/** Declared cells for the erasure criterion. Read by the suite AND by coverage.ts. */
export const CASES: Partial<Record<ShapeKey, string>> = {
  multilingual: 'a purged bilingual record is unreachable through every channel',
  'adversarial-erasure': 'purging sweeps a provisional twin and refuses recapture of the same content',
}
