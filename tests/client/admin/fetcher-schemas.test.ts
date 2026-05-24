// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AdminInstanceViewSchema,
  ApplyInstancesResultSchema,
  InstanceConfigViewSchema,
  PlatformInstanceViewSchema,
  RecentRequestRowSchema,
  RecentRequestsResponseSchema,
  TaskInstanceViewSchema,
} from '../../../client/admin/fetcher-schemas.js'

const expectDefined = <T>(value: T | undefined | null, message: string): NonNullable<T> => {
  expect(value, message).not.toBeUndefined()
  expect(value, message).not.toBeNull()
  return value!
}

describe('RecentRequestRowSchema', () => {
  test('accepts a valid recent request row', () => {
    const row = {
      ts: 1_700_000_000_000,
      modelLabel: 'gpt-4o',
      role: 'main',
      inputTokens: 100,
      outputTokens: 200,
      finishStatus: 'stop',
    }
    const result = RecentRequestRowSchema.safeParse(row)
    expect(result.success).toBe(true)
  })

  test('rejects a row missing required fields', () => {
    const result = RecentRequestRowSchema.safeParse({ ts: 1_700_000_000_000 })
    expect(result.success).toBe(false)
  })
})

describe('RecentRequestsResponseSchema', () => {
  test('accepts a valid response with requests', () => {
    const body = {
      subjectId: 'user-A',
      limit: 25,
      requests: [
        {
          ts: 1_700_000_000_000,
          modelLabel: 'gpt-4o',
          role: 'main',
          inputTokens: 100,
          outputTokens: 200,
          finishStatus: 'stop',
        },
      ],
    }
    const parsed = RecentRequestsResponseSchema.parse(body)
    const firstRequest = expectDefined(parsed.requests[0], 'missing request')
    expect(parsed.requests).toHaveLength(1)
    expect(firstRequest.modelLabel).toBe('gpt-4o')
  })

  test('accepts a valid response with empty requests', () => {
    const body = { subjectId: 'user-B', limit: 25, requests: [] }
    const result = RecentRequestsResponseSchema.safeParse(body)
    expect(result.success).toBe(true)
  })

  test('rejects a response missing subjectId', () => {
    const result = RecentRequestsResponseSchema.safeParse({ limit: 25, requests: [] })
    expect(result.success).toBe(false)
  })
})

describe('instance API schemas', () => {
  const platformInstance = {
    id: 'telegram-main',
    type: 'telegram',
    config: { TELEGRAM_BOT_TOKEN: '***' },
    status: 'active',
    createdAt: '2026-05-24T00:00:00.000Z',
  }

  test('accepts valid platform instance views', () => {
    const parsed = PlatformInstanceViewSchema.parse(platformInstance)
    expect(parsed.id).toBe('telegram-main')
  })

  test('accepts valid task instance views', () => {
    const result = TaskInstanceViewSchema.safeParse({
      id: 'kaneo-main',
      type: 'kaneo',
      config: { KANEO_INTERNAL_URL: 'https://kaneo.example' },
      status: 'pending',
      createdAt: '2026-05-24T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  test('accepts admin records with optional createdAt', () => {
    expect(AdminInstanceViewSchema.safeParse({ userId: 'user-1', platformInstanceId: 'telegram-main' }).success).toBe(
      true,
    )
    expect(
      AdminInstanceViewSchema.safeParse({
        userId: 'user-1',
        platformInstanceId: 'telegram-main',
        createdAt: '2026-05-24T00:00:00.000Z',
      }).success,
    ).toBe(true)
  })

  test('accepts apply result payloads', () => {
    expect(ApplyInstancesResultSchema.parse({ applied: 2 }).applied).toBe(2)
  })

  test('rejects unknown platform, task, and status enums', () => {
    expect(PlatformInstanceViewSchema.safeParse({ ...platformInstance, type: 'slack' }).success).toBe(false)
    expect(TaskInstanceViewSchema.safeParse({ ...platformInstance, type: 'jira' }).success).toBe(false)
    expect(PlatformInstanceViewSchema.safeParse({ ...platformInstance, status: 'running' }).success).toBe(false)
  })

  test('rejects non-string config values', () => {
    expect(InstanceConfigViewSchema.safeParse({ token: 123 }).success).toBe(false)
    expect(PlatformInstanceViewSchema.safeParse({ ...platformInstance, config: { token: 123 } }).success).toBe(false)
  })
})
