// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentUsage, SddEvent } from './events.js'

export function aggregateUsage(events: readonly SddEvent[]): AgentUsage {
  return events.reduce<AgentUsage>(
    (acc, event) => {
      if (event.type !== 'done') return acc
      return {
        inputTokens: acc.inputTokens + event.usage.inputTokens,
        outputTokens: acc.outputTokens + event.usage.outputTokens,
        reasoningTokens: acc.reasoningTokens + event.usage.reasoningTokens,
        costUsd: acc.costUsd + event.usage.costUsd,
        wallMs: acc.wallMs + event.usage.wallMs,
      }
    },
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 },
  )
}
