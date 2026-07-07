// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { appAreaFor } from '../../../client/stories/app-area.js'

describe('appAreaFor', () => {
  test('maps app-prefixed titles to their area (first segment wins)', () => {
    expect(appAreaFor('settings/sections/ByokSection')).toBe('settings')
    expect(appAreaFor('settings/sections/admin/AdminByokSection')).toBe('settings')
    expect(appAreaFor('admin/AdminApp')).toBe('admin')
    expect(appAreaFor('debug/components/LogExplorer')).toBe('debug')
    expect(appAreaFor('transcript/TranscriptApp')).toBe('transcript')
  })

  test('returns null for shared and unmapped areas', () => {
    expect(appAreaFor('shared/ui/Field')).toBeNull()
    expect(appAreaFor('Whatever/Else')).toBeNull()
    expect(appAreaFor('Nobar')).toBeNull()
  })
})
