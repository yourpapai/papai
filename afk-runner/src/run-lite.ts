// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Routing-lite narrowing of a persisted state.json body. */

export interface PersistedLite {
  readonly runId: string
  readonly status: string
  readonly gate: { readonly mode: string; readonly version: number } | null
  readonly changeName: string
  readonly updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Safe narrow of a state.json body to the routing-lite fields; null when unusable. */
export function readLiteRecord(raw: string): Omit<PersistedLite, 'runId'> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const status = parsed['status']
  if (typeof status !== 'string') return null
  const gate = parsed['gate']
  const gateRecord = isRecord(gate) ? gate : null
  const mode = gateRecord === null ? undefined : gateRecord['mode']
  const version = gateRecord === null ? undefined : gateRecord['version']
  const changeName = parsed['changeName']
  const updatedAt = parsed['updatedAt']
  return {
    status,
    gate: typeof mode === 'string' && typeof version === 'number' ? { mode, version } : null,
    changeName: typeof changeName === 'string' ? changeName : '',
    updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
  }
}
