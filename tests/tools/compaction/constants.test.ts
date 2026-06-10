// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  COMPACTION_THRESHOLD_BYTES,
  COMPACTION_PREVIEW_BYTES,
  RESULT_STORE_MAX_ENTRIES,
  RESULT_STORE_TTL_MS,
  EXPAND_DEFAULT_LIMIT_BYTES,
} from '../../../src/tools/compaction/constants.js'

describe('compaction constants', () => {
  it('exports positive numeric constants', () => {
    expect(COMPACTION_THRESHOLD_BYTES).toBeGreaterThan(0)
    expect(COMPACTION_PREVIEW_BYTES).toBeGreaterThan(0)
    expect(RESULT_STORE_MAX_ENTRIES).toBeGreaterThan(0)
    expect(RESULT_STORE_TTL_MS).toBeGreaterThan(0)
    expect(EXPAND_DEFAULT_LIMIT_BYTES).toBeGreaterThan(0)
  })

  it('has preview bytes smaller than threshold bytes', () => {
    expect(COMPACTION_PREVIEW_BYTES).toBeLessThan(COMPACTION_THRESHOLD_BYTES)
  })

  it('has expand default limit smaller than threshold bytes', () => {
    expect(EXPAND_DEFAULT_LIMIT_BYTES).toBeLessThan(COMPACTION_THRESHOLD_BYTES)
  })
})
