// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { resolveReductionFlags } from '../feature-flags.js'
import { CORE_TOOL_NAMES } from './core.js'
import { makeLoadToolTool } from './load-tool.js'
import { createDisclosureSession, type DisclosureSession } from './registry.js'
import { makeSearchToolsTool } from './search-tools.js'
import type { ToolRetriever } from './tool-retriever.js'

/** A no-op stub tool used as a placeholder key to pre-register meta-tool names in the session. */
function makePlaceholder(): ToolSet[string] {
  return tool({ description: 'placeholder', inputSchema: z.object({}), execute: () => ({}) })
}

export function maybeApplyDisclosure(
  tools: ToolSet,
  contextId: string,
  retriever: ToolRetriever,
): { tools: ToolSet; disclosure: DisclosureSession | undefined } {
  if (!resolveReductionFlags(contextId).progressiveDisclosure) return { tools, disclosure: undefined }
  // Pre-populate meta-tool keys so that the session's allNames snapshot includes them.
  const withMeta: ToolSet = { ...tools, search_tools: makePlaceholder(), load_tool: makePlaceholder() }
  const session = createDisclosureSession(withMeta, CORE_TOOL_NAMES)
  // Overwrite placeholders with real implementations bound to the session.
  withMeta['search_tools'] = makeSearchToolsTool(session, retriever, contextId, tools)
  withMeta['load_tool'] = makeLoadToolTool(session, contextId)
  return { tools: withMeta, disclosure: session }
}
