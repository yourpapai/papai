// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('index.ts startup', () => {
  test('does not auto-add ADMIN_USER_ID to authorized users', async () => {
    const source = await Bun.file('src/index.ts').text()

    expect(source).not.toMatch(/import\s+\{[^}]*addUser/u)
    expect(source).not.toMatch(/\baddUser\s*\(/u)
  })
})
