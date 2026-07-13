// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { simplifyFigmaResponse } from './simplify.js'
export type { GlobalVars, SimplifiedDesign, SimplifiedNode } from './simplify-types.js'

export function parseIds(raw: string): string[] {
  return raw
    .split(/[,;]+/u)
    .map((s) => s.trim().replace(/^I/u, ''))
    .filter((s) => s.length > 0)
}
