// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { isToolFailureResult } from '../tool-failure.js'

const READ_ONLY_PREFIXES = ['get_', 'list_', 'search_'] as const

/** Filter an assembled toolset to a read-only subset by name prefix. Returns undefined when none match. */
export const selectReadOnlyTools = (tools: ToolSet): ToolSet | undefined => {
  const entries = Object.entries(tools).filter(([name]) => READ_ONLY_PREFIXES.some((p) => name.startsWith(p)))
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

const containsToolFailure = (value: unknown): boolean => {
  if (isToolFailureResult(value)) return true
  if (Array.isArray(value)) return value.some(containsToolFailure)
  if (value !== null && typeof value === 'object') return Object.values(value).some(containsToolFailure)
  return false
}

/** True when any tool-result message in the turn carries a ToolFailureResult (scanned defensively). */
export const detectToolFailure = (messages: readonly ModelMessage[]): boolean => {
  for (const message of messages) {
    if (message.role !== 'tool') continue
    if (containsToolFailure(message.content)) return true
  }
  return false
}
