// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { en } from '../../src/i18n/locales/en.js'
import { ru } from '../../src/i18n/locales/ru.js'
import type { Dictionary } from '../../src/i18n/types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Collect every dotted key path whose leaf is a string. */
function keyPaths(node: unknown, prefix = ''): string[] {
  if (!isRecord(node)) return []
  const paths: string[] = []
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') paths.push(path)
    else paths.push(...keyPaths(value, path))
  }
  return paths
}

/** Resolve a dotted key path to its leaf value. */
function leafAt(catalog: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => (isRecord(node) ? node[segment] : undefined), catalog)
}

const isNonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.length > 0

describe('locale key parity', () => {
  test('every en key path exists in ru', () => {
    const enKeys = keyPaths(en)
    expect(enKeys.length).toBeGreaterThan(0)
    const ruKeys = new Set(keyPaths(ru))
    const missing = enKeys.filter((key) => !ruKeys.has(key))
    expect(missing).toEqual([])
  })

  test('ru declares no extra keys unknown to en', () => {
    const enKeys = new Set(keyPaths(en))
    const extra = keyPaths(ru).filter((key) => !enKeys.has(key))
    expect(extra).toEqual([])
  })

  test('every ru leaf is a non-empty string', () => {
    const catalog: Dictionary = ru
    const leaves = keyPaths(catalog)
    expect(leaves.length).toBe(keyPaths(en).length)
    for (const path of leaves) {
      expect(isNonEmptyString(leafAt(catalog, path))).toBe(true)
    }
  })
})
