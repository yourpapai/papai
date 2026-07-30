// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Kill switch for dark canonical capture. Default **ON**: capture cannot change a reader
 * answer, and it accrues value only by accruing data, so the useful default is to record.
 * Only the exact string `'off'` disables it; any other value, including unset or empty, is
 * treated as enabled.
 */
export function isCanonicalCaptureEnabled(): boolean {
  return process.env['MEMORY_CANONICAL_CAPTURE'] !== 'off'
}
