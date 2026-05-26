// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { jsonResponse } from '../../src/debug/json-response.js'

const readJson = async (res: Response): Promise<unknown> => JSON.parse(await res.text())

describe('jsonResponse', () => {
  test('sets Content-Type to application/json', () => {
    const res = jsonResponse({ ok: true })

    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  test('body round-trips the input value', async () => {
    const input = { id: 42, name: 'test', nested: { flag: true } }

    const res = jsonResponse(input)

    expect(await readJson(res)).toEqual(input)
  })

  test('defaults to status 200 when no init is provided', () => {
    const res = jsonResponse({ ok: true })

    expect(res.status).toBe(200)
  })

  test('applies init status when provided (e.g. 400)', () => {
    const res = jsonResponse({ error: 'bad_request' }, { status: 400 })

    expect(res.status).toBe(400)
  })

  test('applies init status 201', () => {
    const res = jsonResponse({ created: true }, { status: 201 })

    expect(res.status).toBe(201)
  })

  test('Content-Type is application/json even when custom init is provided', () => {
    const res = jsonResponse({ error: 'not_found' }, { status: 404 })

    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  test('serialises arrays correctly', async () => {
    const input = [1, 2, 3]

    const res = jsonResponse(input)

    expect(await readJson(res)).toEqual(input)
  })

  test('serialises null correctly', async () => {
    const res = jsonResponse(null)

    expect(await readJson(res)).toBeNull()
  })
})
