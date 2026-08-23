// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Instance-config validation; full repo/baseUrl rules land with task 2.1.
export function validateConfig(config: Record<string, string>): Promise<{ ok: true } | { ok: false; reason: string }> {
  void config
  return Promise.resolve({ ok: true })
}
