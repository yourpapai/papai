// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { BenchmarkResult } from './tool-surface-benchmark-report.js'
import type { BenchmarkMode } from './tool-surface-benchmark-scenarios.js'

type ResultIdentity = Readonly<{ model: string; mode: BenchmarkMode; scenario: string }>
type ToolExposure = Readonly<{ fullToolCount: number; exposedToolCount: number }>
type SuccessMetrics = Readonly<{ toolCallCount: number; stepCount: number }>
type FailureDetails = Readonly<{ failureCategory: string | null; failureMessage: string | null }>

export const successBenchmarkResult = (
  identity: ResultIdentity,
  exposure: ToolExposure,
  metrics: SuccessMetrics,
  failure: FailureDetails,
  success: boolean,
): BenchmarkResult => ({
  model: identity.model,
  mode: identity.mode,
  scenario: identity.scenario,
  success,
  failureCategory: failure.failureCategory,
  failureMessage: failure.failureMessage,
  toolCallCount: metrics.toolCallCount,
  stepCount: metrics.stepCount,
  fullToolCount: exposure.fullToolCount,
  exposedToolCount: exposure.exposedToolCount,
})

export const failedBenchmarkResult = (
  identity: ResultIdentity,
  exposure: ToolExposure,
  failure: FailureDetails,
): BenchmarkResult => ({
  model: identity.model,
  mode: identity.mode,
  scenario: identity.scenario,
  success: false,
  failureCategory: failure.failureCategory,
  failureMessage: failure.failureMessage,
  toolCallCount: 0,
  stepCount: 0,
  fullToolCount: exposure.fullToolCount,
  exposedToolCount: exposure.exposedToolCount,
})
