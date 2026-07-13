// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import {
  cancelSchema,
  createCodingTaskSchema,
  emptySchema,
  followupSchema,
  taskRefSchema,
} from '../../../plugins/nerv/schemas.js'

test('create schema requires prompt and forbids extra props', () => {
  expect(createCodingTaskSchema.required).toEqual(['prompt'])
  expect(createCodingTaskSchema.additionalProperties).toBe(false)
  expect(Object.keys(createCodingTaskSchema.properties)).toEqual([
    'project',
    'projects',
    'prompt',
    'kind',
    'costBudgetUsd',
  ])
})

test('followup schema requires text and allows optional taskId', () => {
  expect(followupSchema.required).toEqual(['text'])
  expect(Object.keys(followupSchema.properties)).toEqual(['taskId', 'text'])
})

test('taskRef and cancel schemas take an optional taskId only', () => {
  expect(taskRefSchema.required).toBeUndefined()
  expect(Object.keys(cancelSchema.properties)).toEqual(['taskId'])
})

test('emptySchema forbids all props', () => {
  expect(emptySchema.additionalProperties).toBe(false)
})
