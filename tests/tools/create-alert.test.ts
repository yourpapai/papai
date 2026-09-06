// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { contextSettings, platformInstances, taskInstances } from '../../src/db/schema.js'
import { ACTIVITY_UNAVAILABLE_ERROR } from '../../src/deferred-prompts/activity-gating.js'
import { getAlertPrompt, listAlertPrompts } from '../../src/deferred-prompts/alerts.js'
import type { AlertCondition } from '../../src/deferred-prompts/condition-schema.js'
import { makeCreateAlertTool } from '../../src/tools/create-alert.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

const USER_ID = 'create-alert-user'
const condition = { field: 'task.status', op: 'eq', value: 'Done' }

const extractCreatedId = (result: unknown): string => {
  if (typeof result !== 'object' || result === null || !('id' in result)) {
    throw new Error('Expected created result with id property')
  }
  const id: unknown = Reflect.get(result, 'id')
  if (typeof id !== 'string') throw new Error('Expected created result id to be string')
  return id
}

const errorOf = (result: unknown): string => {
  if (typeof result !== 'object' || result === null || !('error' in result)) {
    throw new Error('Expected an error result')
  }
  const message: unknown = Reflect.get(result, 'error')
  if (typeof message !== 'string') throw new Error('Expected the error to be a string')
  return message
}

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

describe('makeCreateAlertTool — JSON-string conditions', () => {
  const canonicalField: AlertCondition = { field: 'task.status', op: 'eq', value: 'open' }
  const canonicalActivity: AlertCondition = { kind: 'activity', taskId: '417' }

  const seedTaskInstance = (): void => {
    const db = getDrizzleDb()
    db.insert(platformInstances).values({ id: 'telegram-default', type: 'telegram', config: '{}' }).run()
    db.insert(taskInstances).values({ id: 'ti-1', type: 'kaneo', config: '{}', status: 'active' }).run()
    db.insert(contextSettings)
      .values({ contextId: USER_ID, taskInstanceId: 'ti-1', platformInstanceId: 'telegram-default' })
      .run()
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('creates an alert from a JSON-string field condition storing the canonical object', async () => {
    const execute = getToolExecutor(makeCreateAlertTool(USER_ID, USER_ID, 'dm'))
    const result = await execute({
      prompt: 'Notify me',
      condition: '{"field":"task.status","op":"eq","value":"open"}',
    })
    expect(result).toMatchObject({ status: 'created', type: 'alert' })
    const stored = getAlertPrompt(extractCreatedId(result), USER_ID)
    expect(stored).not.toBeNull()
    expect(stored!.condition).toEqual(canonicalField)
  })

  test('creates an alert from a JSON-string activity condition with the capability flag and a configured task instance', async () => {
    seedTaskInstance()
    const execute = getToolExecutor(makeCreateAlertTool(USER_ID, USER_ID, 'dm', undefined, undefined, true))
    const result = await execute({ prompt: 'Notify me', condition: '{"kind":"activity","taskId":"417"}' })
    expect(result).toMatchObject({ status: 'created', type: 'alert' })
    const stored = getAlertPrompt(extractCreatedId(result), USER_ID)
    expect(stored).not.toBeNull()
    expect(stored!.condition).toEqual(canonicalActivity)
  })

  test('a non-JSON string condition returns the structured invalid-condition error and stores nothing', async () => {
    const execute = getToolExecutor(makeCreateAlertTool(USER_ID, USER_ID, 'dm'))
    const result = await execute({ prompt: 'Notify me', condition: 'not json at all' })
    expect(errorOf(result).startsWith('Invalid condition: value is not valid JSON')).toBe(true)
    expect(listAlertPrompts(USER_ID)).toEqual([])
  })

  test('a condition-invalid JSON string returns the schema reason and stores nothing', async () => {
    const execute = getToolExecutor(makeCreateAlertTool(USER_ID, USER_ID, 'dm'))
    const result = await execute({
      prompt: 'Notify me',
      condition: '{"field":"task.status","op":"bogus","value":"open"}',
    })
    expect(errorOf(result)).toContain("Invalid operator 'bogus' for field 'task.status'")
    expect(listAlertPrompts(USER_ID)).toEqual([])
  })
})
