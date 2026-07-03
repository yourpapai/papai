// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { FetchError } from '../../../client/shared/fetcher-helpers.js'
import { formatFetchError } from '../../../client/shared/format-error.js'

describe('formatFetchError', () => {
  test('401 and 403 map to an expired-link message', () => {
    const msg = 'Your settings link may have expired. Send /config to the bot for a new one.'
    expect(formatFetchError(new FetchError(401, 'x'))).toBe(msg)
    expect(formatFetchError(new FetchError(403, 'x'))).toBe(msg)
  })

  test('404 maps to a not-found message', () => {
    expect(formatFetchError(new FetchError(404, 'x'))).toBe('Not found — it may have been removed.')
  })

  test('validation statuses pass the server message through', () => {
    expect(formatFetchError(new FetchError(400, 'bad field'))).toBe('bad field')
    expect(formatFetchError(new FetchError(409, 'conflict'))).toBe('conflict')
    expect(formatFetchError(new FetchError(422, 'invalid request'))).toBe('invalid request')
  })

  test('5xx maps to a generic server message', () => {
    const msg = 'Something went wrong on the server. Try again shortly.'
    expect(formatFetchError(new FetchError(500, 'boom'))).toBe(msg)
    expect(formatFetchError(new FetchError(503, 'down'))).toBe(msg)
  })

  test('a non-FetchError (network failure) maps to a connection message', () => {
    expect(formatFetchError(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    )
  })

  test('an unmapped status passes the underlying message through', () => {
    expect(formatFetchError(new FetchError(418, 'teapot'))).toBe('teapot')
  })
})
