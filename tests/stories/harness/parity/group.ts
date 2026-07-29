// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProvider } from '../../../../src/providers/types.js'

export type ParityHarness = Readonly<{
  provider: TaskProvider
  projectId: string
}>

export type ParityGroup = Readonly<{
  id: string
  title: string
  run(harness: ParityHarness): Promise<void>
}>

/** Unwraps an optional-method result. Both MemoryTaskProvider and KaneoProvider
 *  implement every method a parity group calls, so this never throws at runtime —
 *  it only satisfies the TaskProvider optional-method type without `!`. */
export function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`parity: expected ${label} to be defined`)
  return value
}
