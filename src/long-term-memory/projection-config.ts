// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Kill switch for the dark projection. Default **ON**, matching `MEMORY_CANONICAL_CAPTURE`:
 * the projection writes only to a table no reader queries, and defaulting it off would leave
 * the shadow table empty in every real deployment — which would make Gate 1d's reconciliation
 * compare the live path against nothing and pass trivially.
 *
 * Only the exact string `'off'` disables it; any other value, including unset or empty, is
 * treated as enabled.
 */
export function isCanonicalProjectionEnabled(): boolean {
  return process.env['MEMORY_CANONICAL_PROJECTION'] !== 'off'
}
