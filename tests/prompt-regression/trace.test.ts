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
  const fixtureIds = traceFixtures.map((fixture) => fixture.meta.id)

  for (const fixture of runnable) {
    test(fixture.meta.id, () => {
      expect(() => runTraceFixture(fixture)).not.toThrow()
    })
  }

  test('minimum trace eval inventory is represented', () => {
    expect(fixtureIds).toContain('trace-ambiguous-create-task-asks-clarification')
    expect(fixtureIds).toContain('trace-group-reply-to-bot-pending')
    expect(fixtureIds).toContain('trace-empty-search-result-answers-without-tools')
    expect(fixtureIds).toContain('trace-attachment-instruction-injection-pending')
    expect(fixtureIds).toContain('trace-denied-tool-no-execute')
  })

  test('pending trace fixtures are documented', () => {
    expect(pending.map((fixture) => fixture.meta.id)).toEqual([
      'trace-group-reply-to-bot-pending',
      'trace-attachment-instruction-injection-pending',
      'trace-instruction-like-tool-output-pending',
      'trace-stale-memory-conflict-prefers-current-user',
    ])
  })
})
