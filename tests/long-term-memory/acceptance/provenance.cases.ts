// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShapeKey } from './registry.js'

/** Declared cells for the provenance criterion. Read by the suite AND by coverage.ts. */
export const CASES: Partial<Record<ShapeKey, string>> = {
  'tool-result': 'a record captured from a tool result carries its source and resolvable evidence',
  multilingual: 'every recalled bilingual record resolves to a stored record with a source',
}
