// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scoreQueryResult } from './metrics.js'
import type { RawQueryEvaluation, RunFailure } from './report.js'
import {
  MAX_MEMORY_HIT_CONTENT_CHARACTERS,
  MAX_MEMORY_HIT_PROVENANCE_EVIDENCE_IDS,
  rawQueryResultContractErrors,
  RawQueryResultSchema,
  toOperationalMemoryQuery,
} from './types.js'
import type { MemoryCandidateAdapter, MemoryQuery, RawQueryResult } from './types.js'

type TimedOutcome<Value> =
  | Readonly<{ status: 'success'; value: Value; latencyMs: number }>
  | Readonly<{ status: 'failure'; error: string; latencyMs: number }>
  | Readonly<{ status: 'timeout'; latencyMs: number }>

const elapsed = (startedAt: number, now: () => number): number => {
  const value = now() - startedAt
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export const executeWithDeadline = async <Value>(
  operation: () => Promise<Value>,
  timeoutMs: number,
  now: () => number,
): Promise<TimedOutcome<Value>> => {
  const startedAt = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('memory-runner-timeout'))
    }, timeoutMs)
  })
  try {
    return { status: 'success', value: await Promise.race([operation(), timeout]), latencyMs: elapsed(startedAt, now) }
  } catch (error) {
    const latencyMs = elapsed(startedAt, now)
    const message = error instanceof Error ? error.message : String(error)
    return message === 'memory-runner-timeout'
      ? { status: 'timeout', latencyMs }
      : { status: 'failure', error: message, latencyMs }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const failure = (
  query: MemoryQuery,
  stage: RunFailure['stage'],
  kind: RunFailure['kind'],
  message: string,
): RunFailure => ({
  scenarioId: null,
  queryId: query.queryId,
  stage,
  kind,
  message,
})

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value)

const hitEnvelopeError = (hit: unknown, index: number): string | null => {
  if (hit === null || typeof hit !== 'object') return null
  if ('content' in hit && typeof hit.content === 'string' && hit.content.length > MAX_MEMORY_HIT_CONTENT_CHARACTERS) {
    return `raw hit ${index + 1} content exceeds ${MAX_MEMORY_HIT_CONTENT_CHARACTERS} characters`
  }
  if (!('provenance' in hit) || hit.provenance === null || typeof hit.provenance !== 'object') return null
  if (!('derivedFromEvidenceIds' in hit.provenance)) return null
  const evidenceIds = hit.provenance.derivedFromEvidenceIds
  return isUnknownArray(evidenceIds) && evidenceIds.length > MAX_MEMORY_HIT_PROVENANCE_EVIDENCE_IDS
    ? `raw hit ${index + 1} provenance exceeds ${MAX_MEMORY_HIT_PROVENANCE_EVIDENCE_IDS} evidence IDs`
    : null
}

const rawResultEnvelopeError = (value: unknown, k: number): string | null => {
  if (value === null || typeof value !== 'object') return null
  if (!('status' in value) || value.status !== 'success' || !('hits' in value) || !isUnknownArray(value.hits)) {
    return null
  }
  if (value.hits.length > k) return `raw hit count ${value.hits.length} exceeds query k ${k}`
  for (const [index, hit] of value.hits.entries()) {
    const error = hitEnvelopeError(hit, index)
    if (error !== null) return error
  }
  return null
}

type RetrievalExecutionResult = Readonly<{ rawResult: RawQueryResult; failure: RunFailure | null }>

const validationFailure = (
  query: MemoryQuery,
  stage: RunFailure['stage'],
  latencyMs: number,
  message: string,
): RetrievalExecutionResult => ({
  rawResult: { status: 'failure', queryId: query.queryId, latencyMs, error: message },
  failure: failure(query, stage, 'validation', message),
})

const validateRetrievedValue = (
  query: MemoryQuery,
  stage: RunFailure['stage'],
  value: unknown,
  latencyMs: number,
): RetrievalExecutionResult => {
  const envelopeError = rawResultEnvelopeError(value, query.k)
  if (envelopeError !== null) {
    const message = `Candidate returned invalid raw hits: ${envelopeError}`
    return validationFailure(query, stage, latencyMs, message)
  }
  const parsed = RawQueryResultSchema.safeParse(value)
  if (!parsed.success || parsed.data.queryId !== query.queryId) {
    return validationFailure(query, stage, latencyMs, 'Candidate returned an invalid or mismatched raw query result')
  }
  const contractErrors = rawQueryResultContractErrors(query, parsed.data)
  if (contractErrors.length > 0) {
    const message = `Candidate returned invalid raw hits: ${contractErrors.join('; ')}`
    return validationFailure(query, stage, latencyMs, message)
  }
  const returned: RawQueryResult = { ...parsed.data, latencyMs }
  const returnedFailure =
    returned.status === 'success'
      ? null
      : failure(
          query,
          stage,
          returned.status === 'timeout' ? 'timeout' : 'exception',
          returned.status === 'timeout' ? `Query exceeded ${returned.timeoutMs} ms` : returned.error,
        )
  return { rawResult: returned, failure: returnedFailure }
}

const safelyValidateRetrievedValue = (
  query: MemoryQuery,
  stage: RunFailure['stage'],
  value: unknown,
  latencyMs: number,
): RetrievalExecutionResult => {
  try {
    return validateRetrievedValue(query, stage, value, latencyMs)
  } catch {
    return validationFailure(query, stage, latencyMs, 'Candidate raw query result threw during validation')
  }
}

export const retrieveWithDeadline = async (
  adapter: MemoryCandidateAdapter,
  query: MemoryQuery,
  timeoutMs: number,
  now: () => number,
  stage: 'retrieve' | 'rebuild' = 'retrieve',
): Promise<RetrievalExecutionResult> => {
  const operationalQuery = toOperationalMemoryQuery(query)
  const outcome = await executeWithDeadline(() => adapter.retrieve(operationalQuery), timeoutMs, now)
  if (outcome.status === 'timeout') {
    return {
      rawResult: { status: 'timeout', queryId: query.queryId, latencyMs: outcome.latencyMs, timeoutMs },
      failure: failure(query, stage, 'timeout', `Query exceeded ${timeoutMs} ms`),
    }
  }
  if (outcome.status === 'failure') {
    return {
      rawResult: { status: 'failure', queryId: query.queryId, latencyMs: outcome.latencyMs, error: outcome.error },
      failure: failure(query, stage, 'exception', outcome.error),
    }
  }
  return safelyValidateRetrievedValue(query, stage, outcome.value, outcome.latencyMs)
}

const contextValidatedResult = async (
  adapter: MemoryCandidateAdapter,
  query: MemoryQuery,
  rawResult: RawQueryResult,
  timeoutMs: number,
  now: () => number,
): Promise<Readonly<{ rawResult: RawQueryResult; failure: RunFailure | null }>> => {
  if (rawResult.status !== 'success') return { rawResult, failure: null }
  const operationalQuery = toOperationalMemoryQuery(query)
  const context = await executeWithDeadline(
    () => adapter.assembleContext(operationalQuery, rawResult.hits),
    timeoutMs,
    now,
  )
  if (context.status === 'success') return { rawResult, failure: null }
  const message = context.status === 'timeout' ? `Context assembly exceeded ${timeoutMs} ms` : context.error
  return {
    rawResult:
      context.status === 'timeout'
        ? { status: 'timeout', queryId: query.queryId, latencyMs: rawResult.latencyMs, timeoutMs }
        : { status: 'failure', queryId: query.queryId, latencyMs: rawResult.latencyMs, error: message },
    failure: failure(query, 'context', context.status === 'timeout' ? 'timeout' : 'exception', message),
  }
}

const diagnostics = (query: MemoryQuery, rawResult: RawQueryResult): RawQueryEvaluation['diagnostics'] => {
  if (rawResult.status !== 'success') return { forbiddenHitCount: 0, erasedHitCount: 0 }
  const forbidden = new Set(query.forbiddenEvidenceIds)
  const erased = new Set(query.erasedEvidenceIds)
  return {
    forbiddenHitCount: rawResult.hits.filter(({ evidenceId }) => forbidden.has(evidenceId)).length,
    erasedHitCount: rawResult.hits.filter(({ evidenceId }) => erased.has(evidenceId)).length,
  }
}

export const evaluateQuery = async (
  adapter: MemoryCandidateAdapter,
  query: MemoryQuery,
  timeoutMs: number,
  now: () => number,
): Promise<Readonly<{ evaluation: RawQueryEvaluation; failures: readonly RunFailure[] }>> => {
  const retrieved = await retrieveWithDeadline(adapter, query, timeoutMs, now)
  const context = await contextValidatedResult(adapter, query, retrieved.rawResult, timeoutMs, now)
  const rawResult = context.rawResult
  return {
    evaluation: {
      query,
      rawResult,
      metrics: scoreQueryResult(query, rawResult),
      diagnostics: diagnostics(query, rawResult),
    },
    failures: [retrieved.failure, context.failure].flatMap((entry) => (entry === null ? [] : [entry])),
  }
}

export const failedQueryEvaluation = (query: MemoryQuery, message: string): RawQueryEvaluation => {
  const rawResult: RawQueryResult = {
    status: 'failure',
    queryId: query.queryId,
    latencyMs: 0,
    error: message,
  }
  return {
    query,
    rawResult,
    metrics: scoreQueryResult(query, rawResult),
    diagnostics: { forbiddenHitCount: 0, erasedHitCount: 0 },
  }
}

export const timedOutQueryEvaluation = (query: MemoryQuery, timeoutMs: number): RawQueryEvaluation => {
  const rawResult: RawQueryResult = {
    status: 'timeout',
    queryId: query.queryId,
    latencyMs: timeoutMs,
    timeoutMs,
  }
  return {
    query,
    rawResult,
    metrics: scoreQueryResult(query, rawResult),
    diagnostics: { forbiddenHitCount: 0, erasedHitCount: 0 },
  }
}
