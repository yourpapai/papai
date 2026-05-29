// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function validateConfig(_config: Record<string, string>): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Task 3.5 replaces this stub with a real healthcheck against the entered baseUrl/credential.
  return Promise.resolve({ ok: true })
}
