// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { validateMcpEndpoint } from '../../../../client/settings/lib/validate-mcp-endpoint.js'

describe('validateMcpEndpoint', () => {
  test('flags an empty url as required', () => {
    expect(validateMcpEndpoint({ url: '' }).url).toBe('URL is required.')
  })
  test('treats whitespace-only url as required', () => {
    expect(validateMcpEndpoint({ url: '   ' }).url).toBe('URL is required.')
  })
  test('rejects a non-https url', () => {
    expect(validateMcpEndpoint({ url: 'http://example.com' }).url).toBe('URL must start with https://')
  })
  test('rejects a non-http(s) scheme', () => {
    expect(validateMcpEndpoint({ url: 'ftp://example.com' }).url).toBe('URL must start with https://')
  })
  test('rejects unparseable text', () => {
    expect(validateMcpEndpoint({ url: 'not a url' }).url).toBe('URL must start with https://')
  })
  test('rejects a bare https scheme with no host', () => {
    expect(validateMcpEndpoint({ url: 'https://' }).url).toBe('URL must start with https://')
  })
  test('accepts a valid https url', () => {
    expect(validateMcpEndpoint({ url: 'https://mcp.example.com/sse' }).url).toBeUndefined()
  })
  test('trims before validating a valid url', () => {
    expect(validateMcpEndpoint({ url: '  https://mcp.example.com/sse  ' }).url).toBeUndefined()
  })
  test('rejects an uppercase HTTPS scheme (server is case-sensitive)', () => {
    expect(validateMcpEndpoint({ url: 'HTTPS://example.com' }).url).toBe('URL must start with https://')
  })
  test('rejects a scheme-only https url without a host', () => {
    expect(validateMcpEndpoint({ url: 'https:example.com' }).url).toBe('URL must start with https://')
  })
})
