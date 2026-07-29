// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { keyedHash } from '../stats/hashing.js'

const DEFAULT_SAMPLE_RATE = 0.1

/**
 * Number of leading hex characters of a `keyedHash` output consumed to derive the
 * uniform fraction. 13 hex chars = 52 bits, comfortably inside `Number`'s 53-bit
 * safe-integer precision, so the division below never loses precision.
 */
const FRACTION_HEX_LEN = 13
const FRACTION_DIVISOR = 16 ** FRACTION_HEX_LEN

/**
 * Kill switch for the memory-recall shadow-logging study. Default OFF: only the
 * exact string `'true'` enables it. Any other value (unset, empty, `'1'`, `'TRUE'`,
 * etc.) is treated as disabled.
 */
export function isShadowLoggingEnabled(): boolean {
  return process.env['MEMORY_SHADOW_LOG_ENABLED'] === 'true'
}

/**
 * Configured sample rate for the shadow-logging study, clamped to `[0, 1]`.
 * Falls back to the default for unset, empty, or malformed values.
 */
export function shadowSampleRate(): number {
  const raw = process.env['MEMORY_SHADOW_LOG_SAMPLE_RATE']
  if (raw === undefined || raw === '') return DEFAULT_SAMPLE_RATE

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_RATE

  if (parsed < 0) return 0
  if (parsed > 1) return 1
  return parsed
}

/**
 * Deterministic sampling decision for a given `(contextId, turnRef)`: the same pair
 * always yields the same decision, across calls and across process restarts, because
 * it is derived from `keyedHash` (a stable salted hash) rather than `Math.random`.
 *
 * The hash's leading hex digits are read as a uniform fraction in `[0, 1)` and
 * compared against `rate`.
 */
export function shouldSampleTurn(contextId: string, turnRef: string, rate: number): boolean {
  const hash = keyedHash(`shadow:${contextId}:${turnRef}`)
  const fractionBits = parseInt(hash.slice(0, FRACTION_HEX_LEN), 16)
  const fraction = fractionBits / FRACTION_DIVISOR
  return fraction < rate
}
