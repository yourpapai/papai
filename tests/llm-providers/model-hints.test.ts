// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ModelHintsSchema, parseModelHints } from '../../src/llm-providers/model-hints.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'

const VALID_HINTS = {
  'hf:zai-org/GLM-5.3-Flash': { baseProvider: 'zai-org', baseModel: 'GLM-5.3-Flash' },
  'llama3:70b': { baseProvider: 'ollama', baseModel: 'llama3' },
}

type HintValueRow = Row<{ readonly value: unknown }>

describe('llm-providers model hints', () => {
  describe('ModelHintsSchema', () => {
    test('accepts a map of model ids to alias pairs and preserves it', () => {
      const result = ModelHintsSchema.safeParse(VALID_HINTS)
      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual(VALID_HINTS)
    })

    test('rejects an entry missing an alias', async () => {
      const rows: readonly HintValueRow[] = [
        { label: 'missing baseProvider', value: { 'hf:zai-org/GLM-5.3-Flash': { baseModel: 'GLM-5.3-Flash' } } },
        { label: 'missing baseModel', value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: 'zai-org' } } },
      ]
      await assertEach(rows, (row) => {
        expect(ModelHintsSchema.safeParse(row.value).success).toBe(false)
      })
    })

    test('rejects an empty or whitespace-only alias', async () => {
      const rows: readonly HintValueRow[] = [
        {
          label: 'empty baseProvider',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: '', baseModel: 'GLM-5.3-Flash' } },
        },
        {
          label: 'empty baseModel',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: 'zai-org', baseModel: '' } },
        },
        {
          label: 'whitespace-only baseProvider',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: ' ', baseModel: 'GLM-5.3-Flash' } },
        },
        {
          label: 'whitespace-only baseModel',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: 'zai-org', baseModel: '  ' } },
        },
      ]
      await assertEach(rows, (row) => {
        expect(ModelHintsSchema.safeParse(row.value).success).toBe(false)
      })
    })

    test('trims padded aliases in the parsed output', () => {
      const result = ModelHintsSchema.safeParse({
        'hf:zai-org/GLM-5.3-Flash': { baseProvider: ' zai-org ', baseModel: '\tGLM-5.3-Flash\n' },
      })
      expect(result.success).toBe(true)
      expect(result.data).toStrictEqual({
        'hf:zai-org/GLM-5.3-Flash': { baseProvider: 'zai-org', baseModel: 'GLM-5.3-Flash' },
      })
    })

    test('rejects a value that is not a mapping', async () => {
      const rows: readonly HintValueRow[] = [
        { label: 'null', value: null },
        { label: 'undefined', value: undefined },
        { label: 'number', value: 42 },
        { label: 'string', value: 'nope' },
        { label: 'boolean', value: true },
        { label: 'array', value: ['hf:zai-org/GLM-5.3-Flash'] },
      ]
      await assertEach(rows, (row) => {
        expect(ModelHintsSchema.safeParse(row.value).success).toBe(false)
      })
    })

    test('rejects non-string alias values', async () => {
      const rows: readonly HintValueRow[] = [
        {
          label: 'numeric baseProvider',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: 42, baseModel: 'GLM-5.3-Flash' } },
        },
        {
          label: 'numeric baseModel',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: 'zai-org', baseModel: 7 } },
        },
        {
          label: 'null baseModel',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: 'zai-org', baseModel: null } },
        },
      ]
      await assertEach(rows, (row) => {
        expect(ModelHintsSchema.safeParse(row.value).success).toBe(false)
      })
    })
  })

  describe('parseModelHints', () => {
    test('returns the parsed map for a valid value', () => {
      expect(parseModelHints(VALID_HINTS)).toStrictEqual(VALID_HINTS)
    })

    test('normalizes any unusable value to no hints', async () => {
      const rows: readonly HintValueRow[] = [
        { label: 'missing baseProvider', value: { 'hf:zai-org/GLM-5.3-Flash': { baseModel: 'GLM-5.3-Flash' } } },
        {
          label: 'empty baseProvider',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: '', baseModel: 'GLM-5.3-Flash' } },
        },
        {
          label: 'whitespace-only baseProvider',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: ' ', baseModel: 'GLM-5.3-Flash' } },
        },
        {
          label: 'non-string baseProvider',
          value: { 'hf:zai-org/GLM-5.3-Flash': { baseProvider: 42, baseModel: 'GLM-5.3-Flash' } },
        },
        { label: 'null', value: null },
        { label: 'undefined', value: undefined },
        { label: 'number', value: 42 },
        { label: 'string', value: 'nope' },
        { label: 'array', value: ['hf:zai-org/GLM-5.3-Flash'] },
        { label: 'malformed JSON text', value: '{"hf:zai-org/GLM-5.3-Flash":' },
        { label: 'already empty', value: {} },
      ]
      await assertEach(rows, (row) => {
        expect(parseModelHints(row.value)).toStrictEqual({})
      })
    })
  })
})
