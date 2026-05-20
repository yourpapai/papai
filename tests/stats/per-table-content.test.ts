// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  attachmentsForSubject,
  conversationForSubject,
  messageMetadataForSubject,
} from '../../src/stats/per-table-content.js'

describe('per-table-content helpers smoke check', () => {
  test('all content helpers exported as functions', () => {
    expect(typeof attachmentsForSubject).toBe('function')
    expect(typeof messageMetadataForSubject).toBe('function')
    expect(typeof conversationForSubject).toBe('function')
  })
})
