// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { traceFixtures } from './fixtures/trace/baseline.fixture.js'
import { partitionFixtures } from './harness/fixture-loader.js'
import { runTraceFixture } from './harness/trace-runner.js'

describe('prompt regression trace fixtures', () => {
  const { runnable, pending } = partitionFixtures(traceFixtures)

  for (const fixture of runnable) {
    test(fixture.meta.id, () => {
      expect(() => runTraceFixture(fixture)).not.toThrow()
    })
  }

  test('pending trace fixtures are documented', () => {
    expect(pending.map((fixture) => fixture.meta.id)).toEqual(['trace-stale-memory-conflict-prefers-current-user'])
  })
})
