// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * structured_clarification_v1: a conservative clarification detector built only
 * from bounded tool/config outcome codes. It never inspects assistant or user
 * text — signals carry exactly a bounded error type and code. Coverage counters
 * make undercounting visible instead of silently dropping unmapped codes.
 */

export type ClarificationReason =
  | 'missing_required_input'
  | 'ambiguous_target'
  | 'ambiguous_action'
  | 'permission'
  | 'configuration'

export type ClarificationSignal = Readonly<{
  type: string
  code: string
}>

export type ClarificationDetection = Readonly<{
  detector: 'structured_clarification_v1'
  reason: ClarificationReason | null
  matchedCode: string | null
}>

export type ClarificationCoverage = Readonly<{
  evaluated: number
  matched: number
  unmatchedCodes: readonly string[]
}>

export type ClarificationResult = Readonly<{
  detection: ClarificationDetection
  coverage: ClarificationCoverage
}>

const MAX_UNMATCHED_CODES = 32

const reasonForCode = (code: string): ClarificationReason | null => {
  if (code === 'missing-required' || code === 'validation-failed') return 'missing_required_input'
  if (code === 'not-found' || code.endsWith('-not-found')) return 'ambiguous_target'
  if (code === 'invalid-input' || code === 'workflow-validation-failed' || code === 'unsupported-operation') {
    return 'ambiguous_action'
  }
  if (code === 'access-denied' || code === 'auth-failed') return 'permission'
  if (code === 'config-missing') return 'configuration'
  return null
}

export const detectClarification = (signals: readonly ClarificationSignal[]): ClarificationResult => {
  const unmatched = new Set<string>()
  let matched = 0
  let firstMatch: Readonly<{ reason: ClarificationReason; code: string }> | null = null
  for (const entry of signals) {
    const reason = reasonForCode(entry.code)
    if (reason === null) {
      if (unmatched.size < MAX_UNMATCHED_CODES) unmatched.add(entry.code)
      continue
    }
    matched += 1
    firstMatch ??= { reason, code: entry.code }
  }
  return {
    detection: {
      detector: 'structured_clarification_v1',
      reason: firstMatch?.reason ?? null,
      matchedCode: firstMatch?.code ?? null,
    },
    coverage: {
      evaluated: signals.length,
      matched,
      unmatchedCodes: [...unmatched].sort((left, right) => left.localeCompare(right)),
    },
  }
}
