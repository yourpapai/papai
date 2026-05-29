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

  test('plugin startup compatibility uses safe task instance decoding', () => {
    const source = readFileSync('src/index.ts', 'utf8')
    const compatibilityStart = source.indexOf('collectStartupCompatibilityInstances(')
    const compatibilityEnd = source.indexOf('pluginRegistry.evaluateCompatibilityAcrossInstances', compatibilityStart)
    const compatibilitySource = source.slice(compatibilityStart, compatibilityEnd)

    expect(source).toContain("import { listTaskInstancesSafe } from './instances/task-store.js'")
    expect(compatibilitySource).toContain('taskInstanceResult.instances')
    expect(compatibilitySource).not.toContain('listTaskInstances()')
  })
})
