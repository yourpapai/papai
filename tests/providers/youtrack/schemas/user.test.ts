// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/user.test.ts
import { describe, expect, test } from 'bun:test'

import { UserSchema, UserReferenceSchema } from '../../../../src/providers/youtrack/schemas/user.js'

describe('User schemas', () => {
  const validUser = {
    id: '1-1',
    $type: 'User',
    login: 'john.doe',
    fullName: 'John Doe',
    email: 'john@example.com',
    created: 1700000000000,
  }

  describe('UserSchema', () => {
    test('validates full user', () => {
      const result = UserSchema.parse(validUser)
      expect(result.login).toBe('john.doe')
      expect(result.fullName).toBe('John Doe')
    })

    test('requires login', () => {
      const { login: _, ...invalid } = validUser
      expect(() => UserSchema.parse(invalid)).toThrow()
    })

    test('missing fullName accepts (optional for service accounts)', () => {
      const { fullName: _, ...withoutFullName } = validUser
      const result = UserSchema.parse(withoutFullName)
      expect(result.fullName).toBeUndefined()
    })

    test('missing id rejects', () => {
      const { id: _, ...invalid } = validUser
      expect(() => UserSchema.parse(invalid)).toThrow()
    })

    test('login as number rejects', () => {
      expect(() => UserSchema.parse({ ...validUser, login: 42 })).toThrow()
    })

    test('fullName as number rejects', () => {
      expect(() => UserSchema.parse({ ...validUser, fullName: 42 })).toThrow()
    })

    test('email as null rejects (optional but not nullable)', () => {
      expect(() => UserSchema.parse({ ...validUser, email: null })).toThrow()
    })

    test('email omitted accepts', () => {
      const { email: _, ...withoutEmail } = validUser
      const result = UserSchema.parse(withoutEmail)
      expect(result.email).toBeUndefined()
    })

    test('created as string rejects', () => {
      expect(() => UserSchema.parse({ ...validUser, created: '2024-01-01' })).toThrow()
    })

    test('created as negative number rejects', () => {
      expect(() => UserSchema.parse({ ...validUser, created: -1 })).toThrow()
    })

    test('minimal valid (only required fields)', () => {
      const minimal = { id: '1', login: 'x', fullName: 'X' }
      const result = UserSchema.parse(minimal)
      expect(result.id).toBe('1')
      expect(result.login).toBe('x')
      expect(result.fullName).toBe('X')
    })

    test('extra fields stripped', () => {
      const result = UserSchema.parse({ ...validUser, unknownField: 'x' })
      expect('unknownField' in result).toBe(false)
    })
  })

  describe('UserReferenceSchema', () => {
    test('validates reference', () => {
      const valid = { id: '1-1', $type: 'User', login: 'john.doe' }
      const result = UserReferenceSchema.parse(valid)
      expect(result.login).toBe('john.doe')
    })

    test('missing login rejects', () => {
      expect(() => UserReferenceSchema.parse({ id: '1' })).toThrow()
    })

    test('name omitted accepts', () => {
      const result = UserReferenceSchema.parse({ id: '1', login: 'x' })
      expect(result.name).toBeUndefined()
    })

    test('name as null rejects', () => {
      expect(() => UserReferenceSchema.parse({ id: '1', login: 'x', name: null })).toThrow()
    })
  })
})
