// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('bootstrap startup wiring', () => {
  test('src/index.ts imports bootstrapInstancesFromEnv', () => {
    const source = readFileSync('src/index.ts', 'utf8')
    expect(source).toContain("from './instances/bootstrap.js'")
    expect(source).toContain('bootstrapInstancesFromEnv')
  })

  test('bootstrap is called after initDb()', () => {
    const source = readFileSync('src/index.ts', 'utf8')
    const initDbIdx = source.indexOf('initDb()')
    const bootIdx = source.indexOf('bootstrapInstancesFromEnv(')
    expect(initDbIdx).toBeGreaterThan(-1)
    expect(bootIdx).toBeGreaterThan(initDbIdx)
  })
})
