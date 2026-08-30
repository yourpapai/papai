// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { ACTIVITY_UNAVAILABLE_ERROR } from '../../src/deferred-prompts/activity-gating.js'
import { makeCreateAlertTool } from '../../src/tools/create-alert.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

const USER_ID = 'create-alert-user'
const condition = { field: 'task.status', op: 'eq', value: 'Done' }

const getInputFieldDescription = (schema: unknown, fieldName: string): string | undefined => {
  if (!(schema instanceof z.ZodType)) return undefined
  const jsonSchema = z.toJSONSchema(schema)
  if (!('properties' in jsonSchema) || jsonSchema.properties === undefined) return undefined
  const property = jsonSchema.properties[fieldName]
  if (property === undefined || typeof property !== 'object' || property === null) return undefined
  return 'description' in property && typeof property.description === 'string' ? property.description : undefined
}

describe('makeCreateAlertTool', () => {
  test('description is user-friendly (no "deferred prompt")', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(tool.description).not.toContain('deferred prompt')
  })

  test('tool description mentions per-task watch via task.id', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(tool.description).toContain('specific task')
    expect(tool.description).toContain('task.id')
  })

  test('condition field description mentions per-task watch via task.id', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    const conditionDescription = getInputFieldDescription(tool.inputSchema, 'condition')
    expect(conditionDescription).toContain('task.id')
    expect(conditionDescription).toContain('specific task')
  })

  test('rejects a schedule field (alerts are condition-based only)', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(
      schemaValidates(tool, { prompt: 'x', condition, schedule: { fire_at: { date: '2030-01-01', time: '09:00' } } }),
    ).toBe(false)
  })

  test('rejects a missing condition', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x' })).toBe(false)
  })

  test('accepts a condition', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x', condition })).toBe(true)
  })
})

describe('makeCreateAlertTool — activity alert gating', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('refuses an activity condition with the unavailable guidance by default', async () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    const execute = getToolExecutor(tool)
    const result = await execute({ prompt: 'Notify me', condition: { kind: 'activity', taskId: 'task-1' } })
    expect(result).toEqual({ error: ACTIVITY_UNAVAILABLE_ERROR })
  })
})
