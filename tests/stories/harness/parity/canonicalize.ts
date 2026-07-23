// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Normalizes provider outputs for parity comparison: fields that legitimately
 * differ between MemoryTaskProvider and real Kaneo (ids, timestamps) are blanked
 * to a sentinel after their type is checked, so a comparison asserts shape and
 * stable values without fighting inherent per-provider differences. Array order
 * is preserved so list/sort/paging semantics stay observable.
 */

export const VOLATILE = '<volatile>' as const

export const VOLATILE_KEYS: ReadonlyArray<string> = [
  'id',
  'taskId',
  'projectId',
  'commentId',
  'labelId',
  'relatedTaskId',
  'userId',
  'workspaceId',
  'createdAt',
  'updatedAt',
  'createdBy',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const assertVolatilePresent = (key: string, value: unknown): void => {
  const present = (typeof value === 'string' && value.length > 0) || typeof value === 'number'
  if (!present) {
    throw new Error(`canonicalize: volatile field "${key}" expected a non-empty string or number, got ${String(value)}`)
  }
}

export function canonicalize(value: unknown, volatileKeys: ReadonlyArray<string>): unknown {
  const volatile = new Set(volatileKeys)
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk)
    }
    if (isRecord(node)) {
      const out: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(node)) {
        if (volatile.has(key)) {
          assertVolatilePresent(key, val)
          out[key] = VOLATILE
        } else {
          out[key] = walk(val)
        }
      }
      return out
    }
    return node
  }
  return walk(value)
}
