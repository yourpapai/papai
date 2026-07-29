// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { runTrimInBackground, shouldTriggerTrim } from '../conversation.js'
import { appendHistory } from '../history.js'
import { collectTurnMessages, type TurnMessagesResult } from '../llm-orchestrator-messages.js'
import { logger } from '../logger.js'
import { runMemoryExtractionInBackground } from '../long-term-memory/runner.js'
import { extractFactToolCalls, extractFactToolResults } from '../memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from '../memory.js'

const log = logger.child({ scope: 'deferred:proactive-llm-persist' })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const toolCallCount = (result: unknown): number | undefined => {
  if (!isRecord(result)) return undefined
  const toolCalls = result['toolCalls']
  if (!Array.isArray(toolCalls)) return undefined
  return toolCalls.length
}

type LlmResult = TurnMessagesResult & {
  text: string
  toolCalls: unknown[] | undefined
}

export function persistProactiveResults(
  creatorId: string,
  storageContextId: string,
  configContextId: string,
  contextType: 'dm' | 'group',
  result: LlmResult,
  history: readonly ModelMessage[],
  mainModel: string,
): void {
  const newFacts = extractFactsFromSdkResults(extractFactToolCalls(result), extractFactToolResults(result))
  for (const fact of newFacts) upsertFact(storageContextId, fact)
  if (newFacts.length > 0)
    log.info(
      { userId: creatorId, storageContextId, factsExtracted: newFacts.length },
      'Facts persisted from proactive results',
    )

  const msgs = collectTurnMessages(result)
  if (msgs.length > 0) {
    appendHistory(storageContextId, msgs)
    const updated = [...history, ...msgs]
    if (shouldTriggerTrim(updated, mainModel)) {
      void runTrimInBackground(storageContextId, updated, undefined, configContextId)
      void runMemoryExtractionInBackground({
        storageContextId,
        configContextId,
        contextType,
        history: updated,
      })
    }
  }
  log.debug({ userId: creatorId, toolCalls: toolCallCount(result) }, 'Proactive LLM response received')
}
