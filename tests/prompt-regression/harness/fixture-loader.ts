// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PromptRegressionFixture, PromptRegressionFixtureMeta } from './fixture-types.js'

export interface FixturePartition<T extends PromptRegressionFixture> {
  readonly runnable: readonly T[]
  readonly pending: readonly T[]
}

export function validateFixtureMeta(meta: PromptRegressionFixtureMeta): void {
  if (meta.id.trim() === '') throw new Error('Fixture id must not be empty')
  if (meta.description.trim() === '') throw new Error(`Fixture ${meta.id} must include a description`)
  if (meta.pending === undefined) return
  if (meta.pending.reason.trim() === '') throw new Error(`Pending fixture ${meta.id} must include a reason`)
  if (meta.pending.unskipWhen.trim() === '') {
    throw new Error(`Pending fixture ${meta.id} must include an unskip condition`)
  }
}

export function partitionFixtures<T extends PromptRegressionFixture>(fixtures: readonly T[]): FixturePartition<T> {
  const runnable: T[] = []
  const pending: T[] = []

  for (const fixture of fixtures) {
    validateFixtureMeta(fixture.meta)
    if (fixture.meta.pending === undefined) runnable.push(fixture)
    else pending.push(fixture)
  }

  return { runnable, pending }
}
