// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import {
  activeActorRequestContext,
  featureOpportunitySnapshot,
  getFeatureObserver,
} from '../analytics/feature-observer.js'
import type { AnalyticsRequestContext } from '../analytics/provider-observer.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getPluginsForContext } from '../plugins/registry.js'
import type { ToolMode } from './types.js'

/**
 * Content-free feature-opportunity observation after the available tool
 * surface resolves. Skips silently when analytics is off, no actor scope is
 * active, or the observer fails — opportunity emission never breaks tool
 * assembly and is never inferred from later tool use.
 */
export function observeFeatureOpportunities(
  input: {
    mode: ToolMode
    contextType: 'dm' | 'group' | undefined
    hasProvider: boolean
    hasChatUser: boolean
    codingPluginActive: boolean
    mcpToolCount: number
  },
  requestContext?: AnalyticsRequestContext | null,
): void {
  const resolvedContext = requestContext === undefined ? activeActorRequestContext() : requestContext
  const observer = getFeatureObserver()
  if (resolvedContext === null || observer === null) return
  for (const opportunity of featureOpportunitySnapshot(input)) {
    observer.featureOpportunity(resolvedContext, opportunity)
  }
}

/**
 * Per-invocation opportunity emission over a fully resolved tool surface.
 * Must run on EVERY invocation (including descriptor-cache hits) so the
 * per-(actor, feature, UTC day) series does not collapse; the deterministic
 * source reference keeps at most one durable row per day. `requestContext`
 * overrides the ambient actor scope for call sites that hold an explicit
 * scope outside the AsyncLocalStorage frame.
 */
export function emitResolvedSurfaceOpportunities(input: {
  mode: ToolMode
  contextType: 'dm' | 'group' | undefined
  storageContextId: string | undefined
  chatUserId: string | undefined
  hasProvider: boolean
  tools: ToolSet
  requestContext?: AnalyticsRequestContext | null
}): void {
  const requestContext = input.requestContext === undefined ? activeActorRequestContext() : input.requestContext
  if (requestContext === null || getFeatureObserver() === null) return
  const sharedContextId =
    input.storageContextId === undefined ? undefined : getConfigContextIdFromStorageContextId(input.storageContextId)
  const plugins = sharedContextId === undefined ? [] : getPluginsForContext(sharedContextId)
  const userMcpToolCount = Object.keys(input.tools).filter((name) => name.startsWith('mcp_')).length
  observeFeatureOpportunities(
    {
      mode: input.mode,
      contextType: input.contextType,
      hasProvider: input.hasProvider,
      hasChatUser: input.chatUserId !== undefined,
      codingPluginActive: plugins.some((plugin) => plugin.manifest.id === 'acp'),
      mcpToolCount: userMcpToolCount + (plugins.some((plugin) => plugin.manifest.mcp !== undefined) ? 1 : 0),
    },
    requestContext,
  )
}
