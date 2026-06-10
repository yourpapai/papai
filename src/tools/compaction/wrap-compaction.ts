// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions, ToolSet } from 'ai'

import { logger } from '../../logger.js'
import { COMPACTION_PREVIEW_BYTES } from './constants.js'
import { putResult } from './result-store.js'
import { evaluateForCompaction } from './size-gate.js'
import { summarizeResult } from './summarizer.js'
import type { CompactedEnvelope, CompactionContext } from './types.js'

const log = logger.child({ scope: 'compaction:wrap' })

export interface WrapCompactionDeps {
  summarize: (input: {
    serialized: string
    totalBytes: number
    toolName: string
    userIntent: string
  }) => Promise<{ summary: string | null }>
}

const defaultDeps: WrapCompactionDeps = {
  summarize: (input) => summarizeResult(input),
}

const NEVER_COMPACT = new Set(['expand_result'])

async function compact(
  result: unknown,
  toolName: string,
  ctx: CompactionContext,
  deps: WrapCompactionDeps,
): Promise<unknown> {
  const decision = evaluateForCompaction(result)
  if (!decision.compact) return result
  const handle = putResult(ctx.storageContextId, decision.serialized)
  const { summary } = await deps.summarize({
    serialized: decision.serialized,
    totalBytes: decision.totalBytes,
    toolName,
    userIntent: ctx.userIntent,
  })
  const preview = decision.serialized.slice(0, COMPACTION_PREVIEW_BYTES)
  log.info(
    {
      contextId: ctx.storageContextId,
      tool: toolName,
      totalBytes: decision.totalBytes,
      mode: summary === null ? 'truncated' : 'summary',
    },
    'Tool result compacted',
  )
  const envelope: CompactedEnvelope = {
    _compacted: true,
    handle,
    summary,
    totalBytes: decision.totalBytes,
    preview,
    hint: 'This result was compacted. Call expand_result with this handle (offset/limit) to read the full raw content.',
  }
  return envelope
}

export function applyResultCompaction(
  tools: ToolSet,
  ctx: CompactionContext,
  deps: WrapCompactionDeps = defaultDeps,
): ToolSet {
  if (!ctx.enabled) return tools
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined) continue
    if (t.execute === undefined || NEVER_COMPACT.has(name)) {
      out[name] = t
      continue
    }
    const inner = t.execute.bind(t)
    out[name] = {
      ...t,
      execute: (input: unknown, options: ToolExecutionOptions): Promise<unknown> =>
        Promise.resolve(inner(input, options)).then((result) => compact(result, name, ctx, deps)),
    }
  }
  return out
}
