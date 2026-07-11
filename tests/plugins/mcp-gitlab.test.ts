// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildMrQuery,
  shapeJob,
  shapeMr,
  shapeTreeEntry,
  shapeUser,
  truncateText,
} from '../../plugins/mcp-gitlab/format.js'

describe('mcp-gitlab format', () => {
  test('shapeUser picks known fields and drops unknown ones', () => {
    expect(shapeUser({ id: 1, name: 'A', username: 'a', extra: 'x' })).toEqual({
      id: 1,
      name: 'A',
      username: 'a',
    })
  })

  test('shapeUser returns undefined for non-records', () => {
    expect(shapeUser(null)).toBeUndefined()
  })

  test('shapeTreeEntry picks known fields and drops unknown ones', () => {
    expect(shapeTreeEntry({ id: 'h', name: 'f.ts', type: 'blob', path: 'src/f.ts', mode: '100644', x: 1 })).toEqual({
      id: 'h',
      name: 'f.ts',
      type: 'blob',
      path: 'src/f.ts',
      mode: '100644',
    })
  })

  test('shapeTreeEntry returns empty object for non-records', () => {
    expect(shapeTreeEntry(5)).toEqual({})
  })

  test('shapeMr picks known fields, nested users, filtered labels, and drops unknowns', () => {
    expect(
      shapeMr({
        title: 'T',
        description: 'D',
        state: 'opened',
        web_url: 'u',
        source_branch: 's',
        target_branch: 'm',
        author: { id: 1, name: 'A', username: 'a' },
        assignee: null,
        reviewers: [{ id: 2, name: 'B', username: 'b' }],
        labels: ['x', 'y', 3],
        ignored: 'z',
      }),
    ).toEqual({
      title: 'T',
      description: 'D',
      state: 'opened',
      web_url: 'u',
      source_branch: 's',
      target_branch: 'm',
      author: { id: 1, name: 'A', username: 'a' },
      reviewers: [{ id: 2, name: 'B', username: 'b' }],
      labels: ['x', 'y'],
    })
  })

  test('shapeMr preserves an empty labels array', () => {
    expect(shapeMr({ title: 'T', labels: [] })).toEqual({ title: 'T', labels: [] })
  })

  test('shapeMr returns empty object for non-records', () => {
    expect(shapeMr(5)).toEqual({})
  })

  test('shapeJob picks known fields and always sets log/logTruncated', () => {
    expect(
      shapeJob(
        {
          id: 5,
          name: 'build',
          status: 'success',
          stage: 'test',
          web_url: 'u',
          ref: 'main',
          created_at: 't1',
          duration: 12,
          extra: 'drop',
        },
        'LOG',
        false,
      ),
    ).toEqual({
      id: 5,
      name: 'build',
      status: 'success',
      stage: 'test',
      web_url: 'u',
      ref: 'main',
      created_at: 't1',
      duration: 12,
      log: 'LOG',
      logTruncated: false,
    })
  })

  test('shapeJob returns only log/logTruncated for non-record raw', () => {
    expect(shapeJob(null, 'X', true)).toEqual({ log: 'X', logTruncated: true })
  })

  test('truncateText truncates when over the byte cap', () => {
    expect(truncateText('x'.repeat(10), 5)).toEqual({ text: 'xxxxx', truncated: true })
  })

  test('truncateText leaves short text untouched', () => {
    expect(truncateText('abc', 100)).toEqual({ text: 'abc', truncated: false })
  })

  test('buildMrQuery caps perPage and defaults page', () => {
    const params = new URLSearchParams(buildMrQuery({ state: 'opened', perPage: 150, orderBy: 'updated_at' }))
    expect(params.get('state')).toBe('opened')
    expect(params.get('per_page')).toBe('100')
    expect(params.get('order_by')).toBe('updated_at')
    expect(params.get('page')).toBe('1')
    expect(params.has('search')).toBe(false)
    expect(params.has('labels')).toBe(false)
  })

  test('buildMrQuery omits state=all and uses default perPage', () => {
    const params = new URLSearchParams(buildMrQuery({ state: 'all' }))
    expect(params.has('state')).toBe(false)
    expect(params.get('per_page')).toBe('20')
    expect(params.get('page')).toBe('1')
  })

  test('buildMrQuery maps sourceBranch and explicit page', () => {
    const params = new URLSearchParams(buildMrQuery({ sourceBranch: 'dev', page: 3 }))
    expect(params.get('source_branch')).toBe('dev')
    expect(params.get('page')).toBe('3')
  })
})
