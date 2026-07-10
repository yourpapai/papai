// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { simplifyComment, simplifyComments, simplifyPage } from '../../plugins/mcp-confluence/format.js'

describe('mcp-confluence simplify', () => {
  test('simplifyPage keeps only id/type/title/space{key,name}/body.storage', () => {
    const page = {
      id: '1',
      type: 'page',
      title: 'T',
      status: 'current',
      space: { id: 9, key: 'TEAM', name: 'Team', type: 'global' },
      version: { number: 3 },
      _links: { self: 'x' },
      extensions: {},
      body: { storage: { value: '<p>hi</p>', representation: 'storage' }, view: { value: 'x' } },
    }

    expect(simplifyPage(page)).toEqual({
      id: '1',
      type: 'page',
      title: 'T',
      space: { key: 'TEAM', name: 'Team' },
      body: { storage: { value: '<p>hi</p>', representation: 'storage' } },
    })
  })

  test('simplifyComment drops space', () => {
    const comment = {
      id: '2',
      type: 'comment',
      title: 'RE: T',
      status: 'current',
      space: { id: 9, key: 'TEAM', name: 'Team', type: 'global' },
      version: { number: 1 },
      body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
    }

    expect(simplifyComment(comment)).toEqual({
      id: '2',
      type: 'comment',
      title: 'RE: T',
      body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
    })
  })

  test('simplifyComments maps results and carries paging fields', () => {
    const comment = {
      id: '2',
      type: 'comment',
      title: 'RE: T',
      space: { id: 9, key: 'TEAM', name: 'Team', type: 'global' },
      body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
    }
    const resp = { results: [comment, comment], size: 2, limit: 100, start: 0, _links: {} }

    expect(simplifyComments(resp)).toEqual({
      results: [
        {
          id: '2',
          type: 'comment',
          title: 'RE: T',
          body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
        },
        {
          id: '2',
          type: 'comment',
          title: 'RE: T',
          body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
        },
      ],
      size: 2,
      limit: 100,
      start: 0,
    })
  })

  test('simplifyComments falls back to empty results array when results is not an array', () => {
    expect(simplifyComments({ results: 'nope', size: 1 })).toEqual({ results: [], size: 1 })
  })

  test('simplifyPage on a page missing space omits the space key entirely', () => {
    const page = {
      id: '1',
      type: 'page',
      title: 'T',
      body: { storage: { value: '<p>hi</p>', representation: 'storage' } },
    }
    const result = simplifyPage(page)

    expect(Object.hasOwn(result, 'space')).toBe(false)
    expect(result).toEqual({
      id: '1',
      type: 'page',
      title: 'T',
      body: { storage: { value: '<p>hi</p>', representation: 'storage' } },
    })
  })

  test('simplifyPage on a page missing body.storage omits the body key entirely', () => {
    const page = { id: '1', type: 'page', title: 'T' }
    const result = simplifyPage(page)

    expect(Object.hasOwn(result, 'body')).toBe(false)
  })

  test('simplifyPage on non-object input returns an empty object without throwing', () => {
    expect(simplifyPage(null)).toEqual({})
    expect(simplifyPage('x')).toEqual({})
    expect(simplifyPage(undefined)).toEqual({})
  })

  test('simplifyComment on non-object input returns an empty object without throwing', () => {
    expect(simplifyComment(null)).toEqual({})
    expect(simplifyComment(42)).toEqual({})
  })

  test('simplifyComments on non-object input returns empty results without throwing', () => {
    expect(simplifyComments(null)).toEqual({ results: [] })
    expect(simplifyComments('x')).toEqual({ results: [] })
  })
})
