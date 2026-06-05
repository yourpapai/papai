// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  resolveKonturTalkUserLabel,
  resolveKonturTalkGroupLabel,
} from '../../../plugins/chat-provider-kontur-talk/label-helpers.js'

describe('resolveKonturTalkUserLabel', () => {
  test('returns user_id as-is when no display name API', async () => {
    const apiFetch = (): Promise<unknown> => Promise.resolve({})
    const result = await resolveKonturTalkUserLabel(apiFetch, '@alice:host')
    expect(result).toBe('@alice:host')
  })

  test('returns null for empty userId', async () => {
    const apiFetch = (): Promise<unknown> => Promise.resolve({})
    const result = await resolveKonturTalkUserLabel(apiFetch, '')
    expect(result).toBeNull()
  })
})

describe('resolveKonturTalkGroupLabel', () => {
  test('returns null (no group info API)', async () => {
    const apiFetch = (): Promise<unknown> => Promise.resolve({})
    const result = await resolveKonturTalkGroupLabel(apiFetch, '!room:host')
    expect(result).toBeNull()
  })
})
