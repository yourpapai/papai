// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TodoItem } from './progress-log.js'

/**
 * Todo-tool recognition (agent-todos-capture D2): opencode's `todowrite` and
 * claude's `TodoWrite`. `todoread` (read-only) never matches, and an unknown
 * tool degrades to today's bare marker — silence, not corruption.
 */
export const TODO_TOOLS: ReadonlySet<string> = new Set(['todowrite', 'TodoWrite'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Backend normalization at the decoder boundary (D2): both backends' inputs —
 * opencode `{content, status, priority}`, claude `{content, status,
 * activeForm}` — reduce to `{content, status}` before the hook fires.
 * Agent-internal fields are dropped; items without string content are skipped.
 * Returns null when the input carries no todos array at all.
 */
export function normalizeTodoItems(input: unknown): readonly TodoItem[] | null {
  if (!isObject(input)) return null
  const todos = input['todos']
  if (!Array.isArray(todos)) return null
  const items: TodoItem[] = []
  for (const raw of todos) {
    if (!isObject(raw)) continue
    const content = raw['content']
    if (typeof content !== 'string') continue
    const status = raw['status']
    items.push({ content, status: typeof status === 'string' ? status : 'pending' })
  }
  return items
}
