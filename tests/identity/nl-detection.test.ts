// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, test } from 'bun:test'

import { extractIdentityClaim } from '../../src/identity/nl-detection.js'
import { logger, logMultistream } from '../../src/logger.js'

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

describe('identity claim detection: log attribution', () => {
  // No mockLogger here: the module-bound child logger is the real pino instance,
  // so attribution is asserted against actual egress (see tests/message-cache/store.test.ts).
  test('debug entries carry chatUserId so the claiming admin keeps their own claim text', () => {
    const logLines: string[] = []
    logMultistream.add({ level: 'debug', stream: { write: (chunk: string): void => void logLines.push(chunk) } })
    logger.level = 'debug'
    try {
      extractIdentityClaim("I'm jsmith", 'user-42')
    } finally {
      logger.level = 'silent'
    }
    const called = logLines.find((line) => line.includes('"msg":"extractIdentityClaim called"'))
    expect(called, 'expected an extractIdentityClaim debug log entry').toBeDefined()
    expect(called).toContain('"chatUserId":"user-42"')
    expect(called).toContain('"text":"I\'m jsmith"')
    const detected = logLines.find((line) => line.includes('"msg":"Identity claim detected"'))
    expect(detected, 'expected an Identity claim detected log entry').toBeDefined()
    expect(detected).toContain('"chatUserId":"user-42"')
    expect(detected).toContain('"claimed":"jsmith"')
  })
})
