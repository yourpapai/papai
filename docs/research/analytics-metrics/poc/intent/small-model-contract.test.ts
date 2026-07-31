// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import {
  parseSmallModelRequest,
  parseSmallModelResult,
  runSmallModel,
  type SmallModelRequest,
} from './small-model-contract.js'

const VALID_REQUEST: SmallModelRequest = {
  schema: 'papai.intent.small_model.request.v1',
  taxonomy: 'intent.v1',
  eligible: true,
  message: 'Invented request: create a lighthouse maintenance task.',
  metadata: {
    actor_role: 'member',
    command_family: 'none',
    context_type: 'dm',
    feature_events: [],
    finish_reason: 'tool_calls',
    language_hint: 'en',
    task_provider: 'kaneo',
    tool_goals: ['task.create'],
  },
}

function rejectingFetch(onCall: () => void): () => Promise<Response> {
  return () => {
    onCall()
    return Promise.reject(new Error('must not be called'))
  }
}

test('strictly rejects unknown properties and inconsistent goals', () => {
  expect(parseSmallModelRequest(VALID_REQUEST).ok).toBe(true)
  expect(parseSmallModelRequest({ ...VALID_REQUEST, unexpected: true }).ok).toBe(false)
  expect(
    parseSmallModelResult({
      schema: 'papai.intent.small_model.result.v1',
      taxonomy: 'intent.v1',
      primary: 'task.create',
      goals: ['task.create'],
      confidence: 0.97,
      abstained: false,
    }).ok,
  ).toBe(true)
  expect(
    parseSmallModelResult({
      schema: 'papai.intent.small_model.result.v1',
      taxonomy: 'intent.v1',
      primary: 'task.create',
      goals: ['task.find_list'],
      confidence: 0.97,
      abstained: false,
    }).ok,
  ).toBe(false)
})

test('enforces confidence and unknown-abstention semantics', () => {
  expect(
    parseSmallModelResult({
      schema: 'papai.intent.small_model.result.v1',
      taxonomy: 'intent.v1',
      primary: 'task.create',
      goals: ['task.create'],
      confidence: 0.84,
      abstained: false,
    }).ok,
  ).toBe(false)
  expect(
    parseSmallModelResult({
      schema: 'papai.intent.small_model.result.v1',
      taxonomy: 'intent.v1',
      primary: 'unknown',
      goals: [],
      confidence: 0.7,
      abstained: false,
    }).ok,
  ).toBe(false)
})

test('does not send or disclose content without every opt-in gate', async () => {
  let calls = 0
  const result = await runSmallModel(VALID_REQUEST, {
    apiKey: undefined,
    approved: false,
    endpoint: undefined,
    fetchImpl: rejectingFetch(() => {
      calls += 1
    }),
    model: undefined,
  })
  expect(calls).toBe(0)
  expect(result).toEqual({ ok: false, code: 'CLASSIFIER_NOT_APPROVED' })
  expect(JSON.stringify(result)).not.toContain(VALID_REQUEST.message)
})

test('blocks an ineligible actor before a provider call', async () => {
  let calls = 0
  const result = await runSmallModel(
    { ...VALID_REQUEST, eligible: false },
    {
      apiKey: 'synthetic-key-never-sent',
      approved: true,
      endpoint: 'https://classifier.invalid/v1/chat/completions',
      fetchImpl: rejectingFetch(() => {
        calls += 1
      }),
      model: 'synthetic-small-model',
    },
  )
  expect(calls).toBe(0)
  expect(result).toEqual({ ok: false, code: 'INELIGIBLE_ACTOR' })
  expect(JSON.stringify(result)).not.toContain(VALID_REQUEST.message)
})
