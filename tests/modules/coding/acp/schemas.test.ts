// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  answerPermissionSchema,
  continueSessionSchema,
  emptySchema,
  finishSessionSchema,
  listSessionsSchema,
  sessionIdSchema,
  startSessionSchema,
} from '../../../../src/modules/coding/acp/schemas.js'

describe('acp zod schemas', () => {
  it('startSessionSchema requires project + prompt, allows optional agent/prNumber', () => {
    expect(startSessionSchema.safeParse({ project: 'demo', prompt: 'go' }).success).toBe(true)
    expect(startSessionSchema.safeParse({ project: 'demo', prompt: 'go', agent: 'x', prNumber: 5 }).success).toBe(true)
    expect(startSessionSchema.safeParse({ project: 'demo' }).success).toBe(false)
  })

  it('listSessionsSchema constrains filter to the enum', () => {
    expect(listSessionsSchema.safeParse({}).success).toBe(true)
    expect(listSessionsSchema.safeParse({ filter: 'active' }).success).toBe(true)
    expect(listSessionsSchema.safeParse({ filter: 'bogus' }).success).toBe(false)
  })

  it('sessionIdSchema requires sessionId', () => {
    expect(sessionIdSchema.safeParse({ sessionId: 's1' }).success).toBe(true)
    expect(sessionIdSchema.safeParse({}).success).toBe(false)
  })

  it('finishSessionSchema requires sessionId + action enum', () => {
    expect(finishSessionSchema.safeParse({ sessionId: 's1', action: 'pr' }).success).toBe(true)
    expect(finishSessionSchema.safeParse({ sessionId: 's1', action: 'nope' }).success).toBe(false)
  })

  it('answerPermissionSchema requires sessionId + decision enum', () => {
    expect(answerPermissionSchema.safeParse({ sessionId: 's1', decision: 'allow' }).success).toBe(true)
    expect(answerPermissionSchema.safeParse({ sessionId: 's1', decision: 'maybe' }).success).toBe(false)
  })

  it('continueSessionSchema requires only prompt', () => {
    expect(continueSessionSchema.safeParse({ prompt: 'next' }).success).toBe(true)
    expect(continueSessionSchema.safeParse({ prNumber: 7, project: 'demo', prompt: 'next' }).success).toBe(true)
    expect(continueSessionSchema.safeParse({}).success).toBe(false)
  })

  it('emptySchema accepts an empty object', () => {
    expect(emptySchema.safeParse({}).success).toBe(true)
  })
})
