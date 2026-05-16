// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { extractIdentityClaim } from '../../src/identity/nl-detection.js'

describe('identity claim detection', () => {
  it('should detect "I\'m jsmith" pattern', () => {
    const result = extractIdentityClaim("I'm jsmith")
    expect(result).toBe('jsmith')
  })

  it('should detect "I am jsmith" pattern', () => {
    const result = extractIdentityClaim('I am jsmith')
    expect(result).toBe('jsmith')
  })

  it('should detect "My login is jsmith" pattern', () => {
    const result = extractIdentityClaim('My login is jsmith')
    expect(result).toBe('jsmith')
  })

  it('should detect "Link me to user jsmith" pattern', () => {
    const result = extractIdentityClaim('Link me to user jsmith')
    expect(result).toBe('jsmith')
  })

  it('should detect "I\'m not Alice, I\'m jsmith" pattern', () => {
    const result = extractIdentityClaim("I'm not Alice, I'm jsmith")
    expect(result).toBe('jsmith')
  })

  it('should return null for non-claim messages', () => {
    const result = extractIdentityClaim('Show my tasks')
    expect(result).toBeNull()
  })
})
