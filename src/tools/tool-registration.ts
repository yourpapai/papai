// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Tool, ToolSet } from 'ai'

/**
 * Single scope-free registration point for provider-backed tool descriptors.
 * Assembled/cached descriptors stay unwrapped; the outer
 * `ProviderRequestScope` execution wrapper is attached exactly once per
 * invocation by `finalizeProviderScopedTools` after all filters/compaction/
 * disclosure have produced the actual `ToolSet`.
 */
export function registerProviderBackedTool(tools: ToolSet, name: string, tool: Tool): void {
  tools[name] = tool
}
