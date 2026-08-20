// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ActorRole, ReplyFn } from './chat/types.js'
import type { LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import type { MessageSegment } from './message-edit/segments.js'

export type ProcessMessageRest = readonly [
  configContextId?: string,
  deps?: LlmOrchestratorDeps,
  newAttachmentIds?: readonly string[],
  turnId?: string,
  actorRole?: ActorRole,
  originatingMessageIds?: readonly string[],
  segments?: readonly MessageSegment[],
  isBotAdmin?: boolean,
  platformInstanceId?: string,
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

export const resolveOriginatingMessageIds = (ids: readonly string[] | undefined): readonly string[] => {
  if (ids === undefined) return []
  return ids
}

export const resolveSegments = (segments: readonly MessageSegment[] | undefined): readonly MessageSegment[] => {
  if (segments === undefined) return []
  return segments
}

export type ResolvedProcessMessageInputs = {
  readonly configContextId: string | undefined
  readonly deps: LlmOrchestratorDeps
  readonly newAttachmentIds: readonly string[]
  readonly resolvedTurnId: string
  readonly originatingMessageIds: readonly string[]
  readonly actorRole: ActorRole
  readonly segments: readonly MessageSegment[]
  readonly isBotAdmin: boolean
  readonly platformInstanceId: string | undefined
}

export const resolveProcessMessageInputs = (
  rest: ProcessMessageRest,
  fallbackDeps: LlmOrchestratorDeps,
): ResolvedProcessMessageInputs => {
  const [
    configContextId,
    depsInput,
    newAttachmentIdsInput,
    turnId,
    actorRole = 'member',
    originatingMessageIdsInput,
    segmentsInput,
    isBotAdmin = false,
    platformInstanceId,
  ] = rest
  return {
    configContextId,
    deps: resolveDeps(depsInput, fallbackDeps),
    newAttachmentIds: resolveAttachmentIds(newAttachmentIdsInput),
    resolvedTurnId: resolveTurnId(turnId),
    originatingMessageIds: resolveOriginatingMessageIds(originatingMessageIdsInput),
    actorRole,
    segments: resolveSegments(segmentsInput),
    isBotAdmin,
    platformInstanceId,
  }
}
