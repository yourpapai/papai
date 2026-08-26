// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { FROZEN_COVERAGE_SUPPORT, FROZEN_PARSER_SUPPORT } from '../../scripts/story/inputs.js'

// Synthetic repositories must carry every frozen module the enforcement tree
// imports — the coverage modules and the TypeScript source parser — or capture
// fails on a missing root before it can read anything.
export function writeFrozenSupportInputs(root: string): void {
  for (const relative of [...FROZEN_COVERAGE_SUPPORT, ...FROZEN_PARSER_SUPPORT]) {
    const target = path.join(root, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, `${path.basename(relative)} frozen support`)
  }
}
