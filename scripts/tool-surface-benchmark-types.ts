// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

export type BenchmarkMode = 'direct_full' | 'direct_routed'
export type BenchmarkTask = Readonly<{
  id: string
  title: string
  priority: string
  status: string
  assigneeId: string | null
  comments: readonly string[]
  deleted: boolean
}>
export type BenchmarkRecurringEntry = Readonly<{ id: string; title: string; cadence: string }>
export type BenchmarkDeferredEntry = Readonly<{ id: string; prompt: string; when: string }>
export type BenchmarkScenarioSnapshot = Readonly<{
  tasks: readonly BenchmarkTask[]
  recurringEntries: readonly BenchmarkRecurringEntry[]
  deferredEntries: readonly BenchmarkDeferredEntry[]
  toolCalls: readonly string[]
}>
export type BenchmarkEvaluation = Readonly<{ success: boolean; failureCategory: string | null }>
export type BenchmarkScenario = Readonly<{ id: string; prompt: string }>
export type BenchmarkToolSetup = Readonly<{
  tools: ToolSet
  fullToolCount: number
  exposedToolCount: number
}>
export type BenchmarkStore = {
  tasks: Map<string, BenchmarkTask>
  recurringEntries: Map<string, BenchmarkRecurringEntry>
  deferredEntries: Map<string, BenchmarkDeferredEntry>
  toolCalls: string[]
  nextTaskId: number
  nextRecurringId: number
  nextDeferredId: number
}
