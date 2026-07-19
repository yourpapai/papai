// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

/**
 * AI SDK v7 rejects `role: 'system'` entries inside the `messages` array
 * (they must be supplied via the `instructions` option). Hoist any such messages out
 * of the array and fold their content into the instructions string, preserving order.
 */
export const hoistSystemMessages = (
  instructions: string,
  messages: readonly ModelMessage[],
): { instructions: string; messages: ModelMessage[] } => {
  const systemParts: string[] = []
  const rest: ModelMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') systemParts.push(message.content)
    else rest.push(message)
  }
  if (systemParts.length === 0) return { instructions, messages: [...messages] }
  return {
    instructions: [instructions, ...systemParts].filter((part) => part.length > 0).join('\n\n'),
    messages: rest,
  }
}
