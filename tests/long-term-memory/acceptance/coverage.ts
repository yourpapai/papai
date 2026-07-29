// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Aggregates each criterion's CASES table so the registry's declared criterion x scenario
 * cells can be cross-checked against what the suites actually run. The coupling is a real
 * import that typechecks, rather than a naming convention that rots.
 *
 * These import the `.cases.ts` siblings, never the `.test.ts` suites: this module is reachable
 * from `scripts/memory-acceptance.ts`, which runs outside the test runner where `describe()`
 * throws.
 */

import { CASES as erasure } from './erasure.cases.js'
import { CASES as provenance } from './provenance.cases.js'
import type { CriterionKey, ShapeKey } from './registry.js'
import { SHAPE_KEYS } from './registry.js'
import { CASES as reproducibility } from './reproducibility.cases.js'
import { CASES as scopeIsolation } from './scope-isolation.cases.js'

export const CASE_TABLES: Readonly<Partial<Record<CriterionKey, Partial<Record<ShapeKey, string>>>>> = {
  'scope-isolation': scopeIsolation,
  erasure,
  provenance,
  reproducibility,
}

export function coveredShapes(key: CriterionKey): readonly ShapeKey[] {
  const table = CASE_TABLES[key]
  if (table === undefined) return []
  return SHAPE_KEYS.filter((shape) => table[shape] !== undefined)
}
