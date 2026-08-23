// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { recentLlm, shapeLlmTrace, LLM_TRACE_CAPACITY, type LlmTrace } from '../debug/llm-trace-collector.js'
import { logger } from '../logger.js'
import { PROBE_ERROR, runProbe } from './diagnostics.js'

const log = logger.child({ scope: 'tool:read-llm-traces' })

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export type TraceBufferStats = {
  count: number
  capacity: number
  oldest: number | null
  newest: number | null
}

export type ReadLlmTracesDeps = Partial<
  Readonly<{
    traces: () => LlmTrace[]
  }>
>

const resolveDeps = (deps: ReadLlmTracesDeps): Required<ReadLlmTracesDeps> => ({
  traces: deps.traces ?? (() => recentLlm.slice()),
})

/** Buffer-wide volatility stats derived structurally from the trace array. */
function traceStats(traces: LlmTrace[]): TraceBufferStats {
  return {
    count: traces.length,
    capacity: LLM_TRACE_CAPACITY,
    oldest: traces[0]?.timestamp ?? null,
    newest: traces[traces.length - 1]?.timestamp ?? null,
  }
}

/**
 * Shape-then-filter egress over the raw trace buffer, mirroring the dashboard
 * init frame: own traces verbatim, everything else stripped by `shapeLlmTrace`,
 * caller filters applied to post-shaping traces, then the tail sliced to the
 * clamped limit.
 */
function collectTraces(
  resolved: Required<ReadLlmTracesDeps>,
  chatUserId: string | undefined,
  input: { errors_only?: boolean | undefined; model?: string | undefined; limit?: number | undefined },
): { traces: LlmTrace[]; stats: TraceBufferStats } | typeof PROBE_ERROR {
  const raw = runProbe('read_llm_traces', 'traces', resolved.traces)
  if (raw === PROBE_ERROR) return PROBE_ERROR
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const traces = raw
    .map((t) => shapeLlmTrace(t, chatUserId))
    .filter((t) => input.errors_only !== true || t.error !== undefined)
    .filter((t) => input.model === undefined || t.model === input.model)
    .slice(-limit)
  return { traces, stats: traceStats(raw) }
}

const readLlmTracesInputSchema = z.object({
  errors_only: z.boolean().optional().describe('Only return traces that carry an error'),
  model: z.string().min(1).optional().describe('Only return traces for this model id'),
  limit: z.number().int().min(1).optional().describe('Maximum number of traces to return; default 25, clamped to 100'),
})

type ReadLlmTracesResult = {
  traces: LlmTrace[] | typeof PROBE_ERROR
  stats: TraceBufferStats | typeof PROBE_ERROR
}

/**
 * Read-only view over the in-process LLM trace buffer for bot admins. Own
 * traces pass verbatim; foreign/unattributed traces lose generated text, step
 * detail, tool arguments/results, and identity fields, keeping model ids,
 * durations, token/step counters, tool names, and errors.
 */
export function makeReadLlmTracesTool(chatUserId: string | undefined, deps: ReadLlmTracesDeps = {}): Tool {
  const resolved = resolveDeps(deps)
  return tool({
    description:
      "Read recent LLM call traces from the tail of the in-process trace buffer. Own traces return verbatim; other users' traces are stripped of generated text, step detail, tool arguments/results, and identity, keeping model ids, durations, token/step counters, tool names, and errors. Admin-only; returns no secrets.",
    inputSchema: readLlmTracesInputSchema,
    execute: ({ errors_only, model, limit }): Promise<ReadLlmTracesResult> => {
      const collected = collectTraces(resolved, chatUserId, { errors_only, model, limit })
      log.info({ tool: 'read_llm_traces', requestedLimit: limit ?? DEFAULT_LIMIT }, 'Recent LLM traces read')
      return Promise.resolve(collected === PROBE_ERROR ? { traces: PROBE_ERROR, stats: PROBE_ERROR } : collected)
    },
  })
}
