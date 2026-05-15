// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ScheduledPrompt } from './types.js'

const deliveryGroupKey = (prompt: ScheduledPrompt): string => {
  const target = prompt.deliveryTarget
  const mentionKey = target.audience === 'shared' ? '' : [...target.mentionUserIds].sort().join(',')
  return [
    prompt.createdByUserId,
    target.contextId,
    target.contextType,
    target.threadId ?? '',
    target.audience,
    target.createdByUsername ?? '',
    mentionKey,
  ].join('|')
}

export const groupScheduledPromptsByDelivery = (prompts: readonly ScheduledPrompt[]): Map<string, ScheduledPrompt[]> =>
  prompts.reduce((groups, prompt) => {
    const key = deliveryGroupKey(prompt)
    return new Map(groups).set(key, [...(groups.get(key) ?? []), prompt])
  }, new Map<string, ScheduledPrompt[]>())
