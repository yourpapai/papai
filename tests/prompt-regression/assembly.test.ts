// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { assemblyFixtures } from './fixtures/assembly/baseline.fixture.js'
import { runAssemblyFixture } from './harness/assembly-runner.js'
import { partitionFixtures } from './harness/fixture-loader.js'

describe('prompt regression assembly fixtures', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  const { runnable, pending } = partitionFixtures(assemblyFixtures)

  for (const fixture of runnable) {
    test(fixture.meta.id, () => {
      expect(() => runAssemblyFixture(fixture)).not.toThrow()
    })
  }

  test('pending assembly fixtures are documented', () => {
    expect(pending.map((fixture) => fixture.meta.id)).toContain('assembly-tool-context-reduction-flags-on')
    expect(pending.map((fixture) => fixture.meta.id)).toContain('assembly-memory-trust-labels')
  })
})
