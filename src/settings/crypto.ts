// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 32 random bytes (256 bits) encoded url-safe, no padding. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 of a token, lowercase hex. Only hashes are persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
