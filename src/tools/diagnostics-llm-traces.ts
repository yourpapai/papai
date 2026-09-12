// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { recentLlm, shapeLlmTrace, LLM_TRACE_CAPACITY, type LlmTrace } from '../debug/llm-trace-collector.js'
import { logger } from '../logger.js'
import { type BufferStats, PROBE_ERROR, runProbe, tailStats } from './diagnostics.js'

const log = logger.child({ scope: 'tool:read-llm-traces' })

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export type ReadLlmTracesDeps = Partial<
  Readonly<{
    traces: () => LlmTrace[]
  }>
>

const resolveDeps = (deps: ReadLlmTracesDeps): Required<ReadLlmTracesDeps> => ({
  traces: deps.traces ?? (() => recentLlm.slice()),
})

/** Buffer-wide volatility stats derived structurally from the trace array. */
const traceStats = (traces: LlmTrace[]): BufferStats => tailStats(traces, LLM_TRACE_CAPACITY, (t) => t.timestamp)

/**
 * Egress over the raw trace buffer, mirroring the dashboard init frame's
 * tail: caller filters and the tail slice run on the raw traces, then only
 * the returned entries are shaped (`shapeLlmTrace` preserves the filter
 * fields `error` and `model` verbatim, so pre-shaping filtering is
 * output-identical). Own traces pass verbatim; everything else is stripped
 * by `shapeLlmTrace`.
 */
function collectTraces(
  resolved: Required<ReadLlmTracesDeps>,
  chatUserId: string | undefined,
  input: { errors_only?: boolean | undefined; model?: string | undefined; limit?: number | undefined },
): { traces: LlmTrace[]; stats: BufferStats } | typeof PROBE_ERROR {
  const raw = runProbe('read_llm_traces', 'traces', resolved.traces)
  if (raw === PROBE_ERROR) return PROBE_ERROR
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const traces = raw
    .filter((t) => input.errors_only !== true || t.error !== undefined)
    .filter((t) => input.model === undefined || t.model === input.model)
    .slice(-limit)
    .map((t) => shapeLlmTrace(t, chatUserId))
  return { traces, stats: traceStats(raw) }
}

const readLlmTracesInputSchema = z.object({
  errors_only: z.boolean().optional().describe('Only return traces that carry an error'),
  model: z.string().min(1).optional().describe('Only return traces for this model id'),
  limit: z.number().int().min(1).optional().describe('Maximum number of traces to return; default 25, clamped to 100'),
})

type ReadLlmTracesResult = {
  traces: LlmTrace[] | typeof PROBE_ERROR
  stats: BufferStats | typeof PROBE_ERROR
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
