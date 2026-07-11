// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  shapeActivity,
  shapeAttachment,
  shapeComment,
  shapeFieldOptions,
  shapeFieldValue,
  shapeIssue,
  shapeUser,
} from '../../plugins/mcp-youtrack/format.js'

describe('mcp-youtrack format', () => {
  test('shapeUser picks known fields and drops unknown ones', () => {
    expect(shapeUser({ login: 'u', fullName: 'U Name', x: 1 })).toEqual({ login: 'u', fullName: 'U Name' })
  })

  test('shapeUser returns undefined for non-records', () => {
    expect(shapeUser(null)).toBeUndefined()
  })

  test('shapeUser returns empty object when neither field present', () => {
    expect(shapeUser({})).toEqual({})
  })

  test('shapeFieldValue handles null', () => {
    expect(shapeFieldValue(null)).toBeNull()
  })

  test('shapeFieldValue handles string primitive', () => {
    expect(shapeFieldValue('x')).toBe('x')
  })

  test('shapeFieldValue handles number primitive', () => {
    expect(shapeFieldValue(5)).toBe(5)
  })

  test('shapeFieldValue picks known keys from a record and drops unknown ones', () => {
    expect(shapeFieldValue({ name: 'Open', extra: 1 })).toEqual({ name: 'Open' })
  })

  test('shapeFieldValue picks login/fullName from a record', () => {
    expect(shapeFieldValue({ login: 'u', fullName: 'U' })).toEqual({ login: 'u', fullName: 'U' })
  })

  test('shapeFieldValue maps arrays recursively', () => {
    expect(shapeFieldValue([{ name: 'a' }, { name: 'b' }])).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  test('shapeIssue shapes known fields, nested values, and drops unknowns', () => {
    expect(
      shapeIssue({
        idReadable: 'P-1',
        summary: 'S',
        description: 'D',
        reporter: { login: 'r', fullName: 'R' },
        tags: [{ id: 't1', name: 'bug' }],
        customFields: [
          { name: 'Priority', value: { name: 'High' } },
          { name: 'Assignee', value: { login: 'a', fullName: 'A' } },
        ],
        links: [
          {
            id: 'l1',
            direction: 'OUTWARD',
            linkType: { name: 'relates', sourceToTarget: 'relates to' },
            issues: [{ id: 'i2', idReadable: 'P-2', summary: 'S2' }],
          },
        ],
        junk: 'drop',
      }),
    ).toEqual({
      idReadable: 'P-1',
      summary: 'S',
      description: 'D',
      reporter: { login: 'r', fullName: 'R' },
      tags: [{ id: 't1', name: 'bug' }],
      customFields: [
        { name: 'Priority', value: { name: 'High' } },
        { name: 'Assignee', value: { login: 'a', fullName: 'A' } },
      ],
      links: [
        {
          id: 'l1',
          direction: 'OUTWARD',
          linkType: { name: 'relates', sourceToTarget: 'relates to' },
          issues: [{ id: 'i2', idReadable: 'P-2', summary: 'S2' }],
        },
      ],
    })
  })

  test('shapeIssue returns empty object for non-records', () => {
    expect(shapeIssue(5)).toEqual({})
  })

  test('shapeComment picks known fields and drops unknowns like deleted', () => {
    expect(
      shapeComment({
        id: 'c1',
        text: 'hi',
        created: 5,
        author: { login: 'a' },
        attachments: [{ id: 'f1', name: 'a.log', size: 10, mimeType: 'text/plain' }],
        deleted: false,
      }),
    ).toEqual({
      id: 'c1',
      text: 'hi',
      created: 5,
      author: { login: 'a' },
      attachments: [{ id: 'f1', name: 'a.log', size: 10, mimeType: 'text/plain' }],
    })
  })

  test('shapeComment returns empty object for non-records', () => {
    expect(shapeComment(null)).toEqual({})
  })

  test('shapeActivity shapes known fields', () => {
    expect(
      shapeActivity({
        timestamp: 123,
        field: { name: 'State' },
        added: [{ name: 'Open' }],
        removed: [{ name: 'Fixed' }],
        target: { idReadable: 'P-1' },
      }),
    ).toEqual({
      timestamp: 123,
      field: { name: 'State' },
      added: [{ name: 'Open' }],
      removed: [{ name: 'Fixed' }],
      target: { idReadable: 'P-1' },
    })
  })

  test('shapeActivity returns empty object for non-records', () => {
    expect(shapeActivity(5)).toEqual({})
  })

  test('shapeAttachment shapes known fields and drops unknowns', () => {
    expect(
      shapeAttachment({
        id: 'a',
        name: 'f',
        size: 9,
        mimeType: 'text/plain',
        url: '/api/files/a?sign=x',
        author: { login: 'u' },
        created: 5,
        junk: 'drop',
      }),
    ).toEqual({
      id: 'a',
      name: 'f',
      size: 9,
      mimeType: 'text/plain',
      url: '/api/files/a?sign=x',
      author: { login: 'u' },
      created: 5,
    })
  })

  test('shapeAttachment returns empty object for non-records', () => {
    expect(shapeAttachment(null)).toEqual({})
  })

  test('shapeFieldOptions builds bundle values and marks free-text fields', () => {
    expect(
      shapeFieldOptions({
        customFields: [
          {
            name: 'Priority',
            $type: 'SingleEnumIssueCustomField',
            projectCustomField: { bundle: { values: [{ name: 'High' }, { name: 'Low' }] } },
          },
          { name: 'Assignee', $type: 'SingleUserIssueCustomField' },
        ],
      }),
    ).toEqual([
      { name: 'Priority', type: 'SingleEnumIssueCustomField', values: ['High', 'Low'] },
      { name: 'Assignee', type: 'SingleUserIssueCustomField', free: true },
    ])
  })

  test('shapeFieldOptions filters by fieldName case-insensitively', () => {
    expect(
      shapeFieldOptions(
        {
          customFields: [
            {
              name: 'Priority',
              $type: 'SingleEnumIssueCustomField',
              projectCustomField: { bundle: { values: [{ name: 'High' }, { name: 'Low' }] } },
            },
            { name: 'Assignee', $type: 'SingleUserIssueCustomField' },
          ],
        },
        'priority',
      ),
    ).toEqual([{ name: 'Priority', type: 'SingleEnumIssueCustomField', values: ['High', 'Low'] }])
  })

  test('shapeFieldOptions returns empty array for non-records', () => {
    expect(shapeFieldOptions(5)).toEqual([])
  })

  test('shapeFieldOptions returns empty array when customFields is not an array', () => {
    expect(shapeFieldOptions({ customFields: 'nope' })).toEqual([])
  })
})
