// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/issue-link.test.ts
import { describe, expect, test } from 'bun:test'

import { IssueLinkSchema } from '../../../../src/providers/youtrack/schemas/issue-link.js'

describe('Issue link schemas', () => {
  test('validates embedded link with all fields', () => {
    const valid = {
      id: '0-0',
      $type: 'IssueLink',
      direction: 'OUTWARD',
      linkType: {
        id: '0-0',
        $type: 'IssueLinkType',
        name: 'Relates',
        directed: false,
      },
      issues: [
        {
          id: '0-0',
          idReadable: 'PROJ-456',
          summary: 'Related issue',
        },
      ],
    }
    const result = IssueLinkSchema.parse(valid)
    expect(result.linkType?.name).toBe('Relates')
    expect(result.direction).toBe('OUTWARD')
  })

  test('empty object accepts (all optional)', () => {
    const result = IssueLinkSchema.parse({})
    expect(result).toEqual({})
  })

  test('linkType missing name rejects', () => {
    expect(() => IssueLinkSchema.parse({ linkType: { id: '1' } })).toThrow()
  })

  test('linkType missing id rejects', () => {
    expect(() => IssueLinkSchema.parse({ linkType: { name: 'Relates' } })).toThrow()
  })

  test('issues with invalid item (missing id) rejects', () => {
    expect(() => IssueLinkSchema.parse({ issues: [{ summary: 'x' }] })).toThrow()
  })

  test('issues empty array accepts', () => {
    const result = IssueLinkSchema.parse({ issues: [] })
    expect(result.issues).toEqual([])
  })

  test('issues item with only id accepts', () => {
    const result = IssueLinkSchema.parse({ issues: [{ id: '1' }] })
    expect(result.issues?.[0]?.id).toBe('1')
  })

  test('direction as number rejects', () => {
    expect(() => IssueLinkSchema.parse({ direction: 1 })).toThrow()
  })

  test('linkType.directed as string rejects', () => {
    expect(() => IssueLinkSchema.parse({ linkType: { id: '1', name: 'X', directed: 'yes' } })).toThrow()
  })

  test('multiple issues in array accepts', () => {
    const result = IssueLinkSchema.parse({ issues: [{ id: '1' }, { id: '2' }] })
    expect(result.issues).toHaveLength(2)
  })

  test('linkType with all optional fields populated accepts', () => {
    const result = IssueLinkSchema.parse({
      linkType: {
        id: '1',
        $type: 'IssueLinkType',
        name: 'Subtask',
        directed: true,
        aggregation: false,
        sourceToTarget: 'parent for',
        targetToSource: 'subtask of',
        localizedName: 'Подзадача',
        localizedSourceToTarget: 'родитель для',
        localizedTargetToSource: 'подзадача',
      },
    })
    expect(result.linkType?.directed).toBe(true)
    expect(result.linkType?.sourceToTarget).toBe('parent for')
  })
})
