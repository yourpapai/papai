// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  activeActorRequestContext,
  featureOpportunitySnapshot,
  getFeatureObserver,
} from '../analytics/feature-observer.js'
import { getPluginsForContext } from '../plugins/registry.js'
import type { ToolMode } from './types.js'

/**
 * Content-free feature-opportunity observation after the available tool
 * surface resolves. Skips silently when analytics is off, no actor scope is
 * active, or the observer fails — opportunity emission never breaks tool
 * assembly and is never inferred from later tool use.
 */
export function observeFeatureOpportunities(input: {
  mode: ToolMode
  contextType: 'dm' | 'group' | undefined
  hasProvider: boolean
  hasChatUser: boolean
  codingPluginActive: boolean
  mcpToolCount: number
}): void {
  const requestContext = activeActorRequestContext()
  const observer = getFeatureObserver()
  if (requestContext === null || observer === null) return
  for (const opportunity of featureOpportunitySnapshot(input)) {
    observer.featureOpportunity(requestContext, opportunity)
  }
}

/**
 * Assemble and emit the opportunity observation once the tool surface for a
 * resolved makeTools call is known. `codingPluginActive` is derived from the
 * shared config-context plugin registry so call sites stay slim.
 */
export function emitResolvedSurfaceOpportunities(
  mode: ToolMode,
  contextType: 'dm' | 'group' | undefined,
  sharedContextId: string | undefined,
  chatUserId: string | undefined,
  hasProvider: boolean,
  mcpTools: Record<string, unknown>,
): void {
  observeFeatureOpportunities({
    mode,
    contextType,
    hasProvider,
    hasChatUser: chatUserId !== undefined,
    codingPluginActive:
      sharedContextId !== undefined &&
      getPluginsForContext(sharedContextId).some((plugin) => plugin.manifest.id === 'acp'),
    mcpToolCount: Object.keys(mcpTools).length,
  })
}
