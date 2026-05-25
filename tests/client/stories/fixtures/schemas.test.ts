// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeGlobalStats } from '../../../../client/stories/fixtures/index.js'
import { assertFixturesMatchSchemas } from '../../../../client/stories/fixtures/schemas.js'

describe('fixture schema validation', () => {
  test('passes for default factory output', () => {
    expect(() => assertFixturesMatchSchemas()).not.toThrow()
  })

  test('throws when a fixture drifts from the schema', () => {
    expect(() => assertFixturesMatchSchemas([{ bogus: true }])).toThrow()
  })

  test('makeGlobalStats output parses through the strict GlobalStatsSchema', () => {
    expect(() => assertFixturesMatchSchemas([makeGlobalStats()])).not.toThrow()
  })

  test('default factory output (incl. makeSubjectStats) passes', () => {
    expect(() => assertFixturesMatchSchemas()).not.toThrow()
  })
})
