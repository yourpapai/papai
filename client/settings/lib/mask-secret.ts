// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Normalize server-side secret masking (`****WvfQ`) to the bullet form (`••••WvfQ`). */
export function maskSecret(value: string): string {
  return value.replace(/\*/gu, '•')
}
