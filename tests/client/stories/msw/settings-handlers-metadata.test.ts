// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import { llmModelMetadataHandlers } from '../../../../client/stories/msw/settings-handlers-metadata.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('llm model metadata msw handlers', () => {
  test('modelsDev variant covers /settings/api/llm-model-metadata', () => {
    expect(llmModelMetadataHandlers.modelsDev.length).toBeGreaterThan(0)
    expect(
      pathsOf(llmModelMetadataHandlers.modelsDev).some((p) => p.includes('/settings/api/llm-model-metadata')),
    ).toBe(true)
  })

  test('prefixTable variant covers /settings/api/llm-model-metadata', () => {
    expect(llmModelMetadataHandlers.prefixTable.length).toBeGreaterThan(0)
    expect(
      pathsOf(llmModelMetadataHandlers.prefixTable).some((p) => p.includes('/settings/api/llm-model-metadata')),
    ).toBe(true)
  })

  test('noLimits variant covers /settings/api/llm-model-metadata', () => {
    expect(llmModelMetadataHandlers.noLimits.length).toBeGreaterThan(0)
    expect(pathsOf(llmModelMetadataHandlers.noLimits).some((p) => p.includes('/settings/api/llm-model-metadata'))).toBe(
      true,
    )
  })

  test('catalogueUnavailable variant covers /settings/api/llm-model-metadata', () => {
    expect(llmModelMetadataHandlers.catalogueUnavailable.length).toBeGreaterThan(0)
    expect(
      pathsOf(llmModelMetadataHandlers.catalogueUnavailable).some((p) =>
        p.includes('/settings/api/llm-model-metadata'),
      ),
    ).toBe(true)
  })
})
