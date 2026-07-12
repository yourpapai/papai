// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import type { ToolCapabilityCatalog } from '../runtime/capability-catalog.js'

export const CORE_TOOL_CAPABILITIES = Object.freeze({
  'tasks.create': 'create_task',
  'tasks.get': 'get_task',
  'tasks.list': 'list_tasks',
  'tasks.search': 'search_tasks',
} as const)

export function registerOfferedCoreToolCapabilities(tools: ToolSet, catalog: ToolCapabilityCatalog): void {
  for (const [capabilityId, wireName] of Object.entries(CORE_TOOL_CAPABILITIES)) {
    if (tools[wireName] !== undefined) catalog.register(capabilityId, wireName)
  }
}
