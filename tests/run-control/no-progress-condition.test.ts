// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createNoProgressCondition, NO_PROGRESS_STEPS } from '../../src/run-control/no-progress-condition.js'

type Step = { toolCalls?: Array<{ toolName: string }> }

const productive = (name = 'create_task'): Step => ({ toolCalls: [{ toolName: name }] })
const meta = (name = 'search_tools'): Step => ({ toolCalls: [{ toolName: name }] })
const empty = (): Step => ({ toolCalls: [] })

describe('createNoProgressCondition', () => {
  test('returns false when fewer than NO_PROGRESS_STEPS steps have run', () => {
    const condition = createNoProgressCondition()
    const steps = Array.from({ length: NO_PROGRESS_STEPS - 1 }, () => meta())
    expect(condition({ steps })).toBe(false)
  })

  test('returns false while the trailing window contains a productive tool call', () => {
    const condition = createNoProgressCondition()
    const steps: Step[] = [meta(), meta(), productive()]
    expect(condition({ steps })).toBe(false)
  })

  test('returns true when the whole trailing window is meta-only churn', () => {
    const condition = createNoProgressCondition()
    const steps: Step[] = [productive(), meta('search_tools'), meta('load_tool'), meta('search_tools')]
    expect(condition({ steps })).toBe(true)
  })

  test('treats a window of empty (no-call) steps as no progress', () => {
    const condition = createNoProgressCondition()
    const steps: Step[] = Array.from({ length: NO_PROGRESS_STEPS }, () => empty())
    expect(condition({ steps })).toBe(true)
  })

  test('a single productive step within the window keeps the loop alive', () => {
    const condition = createNoProgressCondition()
    const steps: Step[] = [meta(), productive('update_task'), meta()]
    expect(condition({ steps })).toBe(false)
  })

  test('returns false for an empty steps array (start of turn)', () => {
    const condition = createNoProgressCondition()
    expect(condition({ steps: [] })).toBe(false)
  })
})
