// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from './chat/types.js'
import type { LlmOrchestratorDeps } from './llm-orchestrator-types.js'

export type ProcessMessageRest = readonly [
  configContextId?: string,
  deps?: LlmOrchestratorDeps,
  newAttachmentIds?: readonly string[],
  turnId?: string,
]

export type ProcessMessageFn = (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  userText: string,
  contextType: 'dm' | 'group',
  ...rest: ProcessMessageRest
) => Promise<void>

export const resolveDeps = (
  deps: LlmOrchestratorDeps | undefined,
  fallback: LlmOrchestratorDeps,
): LlmOrchestratorDeps => {
  if (deps === undefined) return fallback
  return deps
}

export const resolveAttachmentIds = (attachmentIds: readonly string[] | undefined): readonly string[] => {
  if (attachmentIds === undefined) return []
  return attachmentIds
}

export const resolveTurnId = (turnId: string | undefined): string => {
  if (turnId === undefined) return crypto.randomUUID()
  return turnId
}
