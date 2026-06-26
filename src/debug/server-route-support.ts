// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listScheduledPrompts } from '../deferred-prompts/scheduled.js'
import { getIdentityMapping } from '../identity/mapping.js'
import { listMemos } from '../memos.js'
import { listRecurringTasks } from '../recurring.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function resolveParamDefault(value: string | null, fallback: string): string {
  if (value !== null) return value
  return fallback
}

export function handleRecurring(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const tasks = listRecurringTasks(userId)
  return jsonResponse(tasks)
}

export function handleDeferred(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const prompts = listScheduledPrompts(userId)
  return jsonResponse(prompts)
}

export function handleMemos(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const state = resolveParamDefault(url.searchParams.get('state'), 'active')
  const memos = listMemos(userId, 100, state)
  return jsonResponse(memos)
}

export function handleIdentity(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const providerName = resolveParamDefault(url.searchParams.get('provider'), 'task-provider')
  const mapping = getIdentityMapping(userId, providerName)
  if (mapping === null) {
    return new Response('Not found', { status: 404 })
  }
  return jsonResponse(mapping)
}
