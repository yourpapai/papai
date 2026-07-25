// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { ContextType } from '../chat/types.js'
import type { ResolvedStreamTextResult } from '../llm-orchestrator-events.js'
import { logger } from '../logger.js'
import { resolveMemoryScope } from './scope.js'
import { isShadowLoggingEnabled, shadowSampleRate, shouldSampleTurn } from './shadow-log-config.js'
import { buildShadowLogRow } from './shadow-log-row.js'
import { extractSearchMemoryPulls } from './shadow-pull-extract.js'
import { runShadowRecall } from './shadow-recall.js'
import { insertShadowLogRow } from './store.js'

const log = logger.child({ scope: 'long-term-memory:shadow-log' })

export type ScheduleShadowRecallLogArgs = Readonly<{
  /** Storage-scoped context id of the turn (the orchestrator's `contextId`). */
  contextId: string
  /** Config context id, used to resolve the shadow embedding's BYOK/model creds. */
  configId: string
  contextType: ContextType
  /** The reader model that produced this turn; results are keyed per model, never averaged. */
  readerModelId: string
  /** Opaque turn identifier; already content-free (join key, not free text). */
  turnRef: string
  /** The messages sent to the model this turn; only the last `user` message's text is used. */
  messages: readonly ModelMessage[]
  /** The resolved turn's steps, walked for `search_memory` pulls. */
  steps: ResolvedStreamTextResult['steps']
}>

export type ScheduleShadowRecallLogDeps = Readonly<{
  isShadowLoggingEnabled: typeof isShadowLoggingEnabled
  shadowSampleRate: typeof shadowSampleRate
  shouldSampleTurn: typeof shouldSampleTurn
  runShadowRecall: typeof runShadowRecall
  extractSearchMemoryPulls: typeof extractSearchMemoryPulls
  buildShadowLogRow: typeof buildShadowLogRow
  insertShadowLogRow: typeof insertShadowLogRow
}>

const defaultDeps: ScheduleShadowRecallLogDeps = {
  isShadowLoggingEnabled,
  shadowSampleRate,
  shouldSampleTurn,
  runShadowRecall,
  extractSearchMemoryPulls,
  buildShadowLogRow,
  insertShadowLogRow,
}

type UserTextPart = Readonly<{ type: 'text'; text: string }>

const isUserTextPart = (part: unknown): part is UserTextPart =>
  typeof part === 'object' &&
  part !== null &&
  (part as { type?: unknown }).type === 'text' &&
  typeof (part as { text?: unknown }).text === 'string'

/**
 * The shadow query is the raw last user turn (the conservative floor — no
 * `deriveInjectionQuery`, no extra generation call; see the shadow-logging design doc).
 * Returns `undefined` when no user message (or no extractable text) is present, in which
 * case there is nothing to shadow-query.
 */
function extractLastUserMessageText(messages: readonly ModelMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message === undefined || message.role !== 'user') continue

    const { content } = message
    if (typeof content === 'string') {
      if (content.length > 0) return content
      continue
    }
    if (Array.isArray(content)) {
      const text = content
        .filter(isUserTextPart)
        .map((part) => part.text)
        .join('')
      if (text.length > 0) return text
    }
  }
  return undefined
}

async function runShadowRecallLog(args: ScheduleShadowRecallLogArgs, deps: ScheduleShadowRecallLogDeps): Promise<void> {
  if (!deps.isShadowLoggingEnabled()) return
  if (!deps.shouldSampleTurn(args.contextId, args.turnRef, deps.shadowSampleRate())) return

  const shadowQuery = extractLastUserMessageText(args.messages)
  if (shadowQuery === undefined) return

  const scope = resolveMemoryScope({ storageContextId: args.contextId, contextType: args.contextType })
  const result = await deps.runShadowRecall({
    storageContextId: args.contextId,
    configContextId: args.configId,
    contextType: args.contextType,
    query: shadowQuery,
  })
  const pull = deps.extractSearchMemoryPulls(args.steps)

  const row = deps.buildShadowLogRow({
    scope: `${scope.scopeType}:${scope.scopeId}`,
    contextId: args.contextId,
    turnRef: args.turnRef,
    readerModelId: args.readerModelId,
    activeRecordCount: result.activeRecordCount,
    shadowQuery,
    shadowHits: result.hits,
    pull,
  })
  deps.insertShadowLogRow(row)
}

/**
 * Off-hot-path entrypoint for the memory-recall shadow-logging study. Synchronous,
 * returns immediately: all real work (the kill-switch/sampling guards, the counterfactual
 * recall, and the insert) is deferred into a `queueMicrotask`, so this call adds zero
 * latency to the user-facing turn and never injects anything into the prompt (pattern:
 * `src/cache-db.ts`).
 *
 * Any failure inside the microtask — including a rejected `runShadowRecall` — is caught,
 * logged at `warn`, and swallowed; it must never surface to (or delay) the turn.
 */
export function scheduleShadowRecallLog(
  args: ScheduleShadowRecallLogArgs,
  deps: ScheduleShadowRecallLogDeps = defaultDeps,
): void {
  queueMicrotask(() => {
    runShadowRecallLog(args, deps).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(
        { contextId: args.contextId, turnRef: args.turnRef, error: message },
        'Shadow recall log failed; skipping this turn',
      )
    })
  })
}
