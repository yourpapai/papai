// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  snapshotFromStore,
  type BenchmarkDeferredEntry,
  type BenchmarkEvaluation,
  type BenchmarkMode,
  type BenchmarkRecurringEntry,
  type BenchmarkScenario,
  type BenchmarkScenarioSnapshot,
  type BenchmarkStore,
  type BenchmarkTask,
  type BenchmarkToolSetup,
} from './tool-surface-benchmark-scenarios-support.js'
import { buildDirectTools } from './tool-surface-benchmark-scenarios-tools.js'

export {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  snapshotFromStore,
  type BenchmarkDeferredEntry,
  type BenchmarkEvaluation,
  type BenchmarkMode,
  type BenchmarkRecurringEntry,
  type BenchmarkScenario,
  type BenchmarkScenarioSnapshot,
  type BenchmarkStore,
  type BenchmarkTask,
  type BenchmarkToolSetup,
}

export const toolsForMode = (mode: BenchmarkMode, prompt: string, store: BenchmarkStore): BenchmarkToolSetup => {
  void mode
  void prompt
  const directTools = buildDirectTools(store)
  const fullToolCount = Object.keys(directTools).length

  return { tools: directTools, fullToolCount, exposedToolCount: fullToolCount }
}
