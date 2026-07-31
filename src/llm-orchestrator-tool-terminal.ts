// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Bounded analytics terminal classification for a completed tool call. Maps the
 * internal failure taxonomy onto the controlled execution outcome, error class,
 * and status class enums — raw provider codes and messages never pass through.
 */

import type { ToolFailureResult } from './tool-failure.js'
import { isPermissionDeniedResult } from './tools/permission-gate.js'

export type ToolExecutionOutcome = 'semantic_success' | 'structured_failure' | 'thrown_failure' | 'permission_denied'

export type ToolTerminalClassification = Readonly<{
  outcome: ToolExecutionOutcome
  errorClass: string | null
  statusClass: string
  retryable: boolean | null
  recoveredSameTurn: boolean
}>

/** Bounded ErrorClass mapping from the classified tool failure; never carries raw codes. */
const errorClassOf = (failure: ToolFailureResult): string => {
  const code = failure.errorCode
  if (code === 'interrupted') return 'cancelled'
  if (code === 'expired' || code === 'timeout') return 'timeout'
  if (code === 'rate-limited') return 'rate_limit'
  if (code === 'access-denied' || code === 'auth-failed') return 'authorization'
  if (code === 'config-missing') return 'configuration'
  if (code === 'network-error') return 'network'
  if (code === 'missing-required' || code === 'invalid-input' || code === 'validation-failed') return 'validation'
  if (code.endsWith('-not-found')) return 'not_found'
  if (failure.errorType === 'llm') return 'llm_provider'
  if (failure.errorType === 'validation') return 'validation'
  if (failure.errorType === 'system') return 'internal'
  if (failure.errorType === 'tool-execution') return 'internal'
  return 'other'
}

/** Bounded StatusClass mapping derived from the bounded error class. */
const statusClassOf = (errorClass: string): string => {
  if (errorClass === 'timeout') return 'timeout'
  if (errorClass === 'network') return 'network'
  if (errorClass === 'authorization') return 'auth'
  return 'other'
}

export const classifyToolTerminal = (
  result: Readonly<{ success: boolean; output: unknown }>,
  failure: ToolFailureResult | null,
): ToolTerminalClassification => {
  if (!result.success) {
    const errorClass = failure === null ? 'internal' : errorClassOf(failure)
    return {
      outcome: 'thrown_failure',
      errorClass,
      statusClass: statusClassOf(errorClass),
      retryable: failure?.retryable ?? null,
      recoveredSameTurn: failure?.recovered ?? false,
    }
  }
  if (isPermissionDeniedResult(result.output)) {
    return {
      outcome: 'permission_denied',
      errorClass: 'permission',
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    }
  }
  if (failure !== null) {
    const errorClass = errorClassOf(failure)
    return {
      outcome: 'structured_failure',
      errorClass,
      statusClass: statusClassOf(errorClass),
      retryable: failure.retryable,
      recoveredSameTurn: failure.recovered ?? false,
    }
  }
  return {
    outcome: 'semantic_success',
    errorClass: null,
    statusClass: 'none',
    retryable: null,
    recoveredSameTurn: false,
  }
}
