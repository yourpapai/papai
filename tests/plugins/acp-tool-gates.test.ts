// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpFetch } from '../../plugins/acp/client.js'
import { continueSessionTool } from '../../plugins/acp/continue-tool.js'
import {
  answerPermissionTool,
  cancelSessionTool,
  finishSessionTool,
  startSessionTool,
} from '../../plugins/acp/session-tools.js'

// The factories take an httpFetch; a no-op stub is fine — we only inspect the returned shape.
const noopFetch: HttpFetch = () => Promise.resolve(new Response('{}'))

describe('acp session-action tools declare an operator gate', () => {
  test('all five are gate: "operator"', () => {
    const tools = [
      startSessionTool(noopFetch),
      finishSessionTool(noopFetch),
      cancelSessionTool(noopFetch),
      answerPermissionTool(noopFetch),
      continueSessionTool(noopFetch),
    ]
    for (const t of tools) {
      expect(t.gate).toBe('operator')
    }
  })
})
