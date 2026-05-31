// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { validateConfig } from '../../../plugins/task-provider-kaneo/validate-config.js'

describe('validateConfig', () => {
  test('valid https baseUrl returns ok: true', async () => {
    const result = await validateConfig({ baseUrl: 'https://kaneo.example' })
    expect(result).toEqual({ ok: true })
  })

  test('valid http localhost baseUrl returns ok: true', async () => {
    const result = await validateConfig({ baseUrl: 'http://localhost:3000' })
    expect(result).toEqual({ ok: true })
  })

  test('missing baseUrl returns ok: false with baseUrl reason', async () => {
    const result = await validateConfig({})
    expect(result).toEqual({ ok: false, reason: 'baseUrl is required' })
  })

  test('empty baseUrl returns ok: false with baseUrl reason', async () => {
    const result = await validateConfig({ baseUrl: '' })
    expect(result).toEqual({ ok: false, reason: 'baseUrl is required' })
  })

  test('malformed baseUrl returns ok: false', async () => {
    const result = await validateConfig({ baseUrl: 'not a url' })
    expect(result).toEqual({ ok: false, reason: 'baseUrl must be a valid URL' })
  })

  test('non-http protocol returns ok: false with http reason', async () => {
    const result = await validateConfig({ baseUrl: 'ftp://host' })
    expect(result).toEqual({ ok: false, reason: 'baseUrl must use http or https' })
  })
})
