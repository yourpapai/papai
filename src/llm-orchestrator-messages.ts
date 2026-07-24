// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

type StepLike = { response?: { messages?: readonly ModelMessage[] } }

/** The subset of an AI SDK `generateText` result we read to reconstruct a turn's messages. */
export type TurnMessagesResult = {
  steps?: readonly StepLike[]
  finalStep?: StepLike
}

/**
 * Collect every message a turn produced, in order, across all tool-loop steps.
 *
 * Under AI SDK v7 `result.response.messages` (and `result.finalStep.response.messages`) hold
 * only the *final* step's messages — the trailing assistant answer — not the assistant
 * tool-call / tool-result messages from earlier steps. Reading `finalStep.response.messages`
 * therefore drops the whole tool trace, which breaks history persistence (a resumed turn loses
 * the tool context) and tool-failure detection (the failing tool-result is never inspected).
 * The full, ordered trace lives on `result.steps[].response.messages`; flatten it.
 */
export const collectTurnMessages = (result: TurnMessagesResult): ModelMessage[] =>
  result.steps === undefined || result.steps.length === 0
    ? [...(result.finalStep?.response?.messages ?? [])]
    : result.steps.flatMap((step) => [...(step.response?.messages ?? [])])
