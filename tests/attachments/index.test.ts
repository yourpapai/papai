// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('attachments/index re-exports', () => {
  test('exports staged file functions', async () => {
    const mod = await import('../../src/attachments/index.js')
    expect(typeof mod.stageFileMetadata).toBe('function')
    expect(typeof mod.searchStagedFiles).toBe('function')
    expect(typeof mod.findStagedFilesByMessageId).toBe('function')
    expect(typeof mod.purgeExpiredStagedFiles).toBe('function')
    expect(typeof mod.resolveStagedFile).toBe('function')
  })
})
