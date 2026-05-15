// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { renderTreeView, renderPropertiesTree } from '../../../client/debug/tree-view.js'

describe('tree-view', () => {
  describe('renderTreeView', () => {
    test('renders primitive string', () => {
      const html = renderTreeView('hello world')
      expect(html).toContain('"hello world"')
      expect(html).toContain('tree-string')
    })

    test('renders primitive number', () => {
      const html = renderTreeView(42)
      expect(html).toContain('42')
      expect(html).toContain('tree-number')
    })

    test('renders primitive boolean', () => {
      const html = renderTreeView(true)
      expect(html).toContain('true')
      expect(html).toContain('tree-boolean')
    })

    test('renders null', () => {
      const html = renderTreeView(null)
      expect(html).toContain('null')
      expect(html).toContain('tree-null')
    })

    test('renders undefined', () => {
      const html = renderTreeView(undefined)
      expect(html).toContain('undefined')
      expect(html).toContain('tree-undefined')
    })

    test('renders object with key', () => {
      const html = renderTreeView({ foo: 'bar' }, 'myKey')
      expect(html).toContain('myKey:')
      expect(html).toContain('tree-toggle')
      expect(html).toContain('{')
    })

    test('renders array with toggle', () => {
      const html = renderTreeView([1, 2, 3], 'items')
      expect(html).toContain('items:')
      expect(html).toContain('tree-toggle')
      expect(html).toContain('[')
      expect(html).toContain(']')
    })

    test('renders nested objects', () => {
      const obj = {
        level1: {
          level2: {
            level3: 'deep value',
          },
        },
      }
      const html = renderTreeView(obj)
      expect(html).toContain('level1:')
      expect(html).toContain('level2:')
      expect(html).toContain('level3:')
      expect(html).toContain('"deep value"')
    })

    test('renders empty array without toggle', () => {
      const html = renderTreeView([])
      expect(html).toContain('[]')
      expect(html).not.toContain('tree-toggle')
    })

    test('renders empty object without toggle', () => {
      const html = renderTreeView({})
      expect(html).toContain('{}')
      expect(html).not.toContain('tree-toggle')
    })

    test('escapes HTML in strings', () => {
      const html = renderTreeView('<script>alert("xss")</script>')
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>')
    })

    test('generates unique toggle IDs', () => {
      const html1 = renderTreeView({ a: 1 }, 'key1')
      const html2 = renderTreeView({ b: 2 }, 'key2')
      const pattern = /(?:data-target|id)="(tree-[a-z0-9]+)"/
      const m1 = html1.match(pattern)
      const m2 = html2.match(pattern)
      expect(m1).toBeDefined()
      expect(m2).toBeDefined()
      expect(m1?.[1]).toBeDefined()
      expect(m2?.[1]).toBeDefined()
      expect(m1?.[1]).not.toBe(m2?.[1])
    })

    test('renders object without key', () => {
      const html = renderTreeView({ foo: 'bar' })
      expect(html).toContain('tree-toggle')
      expect(html).toContain('foo:')
      expect(html).toContain('{')
    })

    test('renders primitive without key', () => {
      const html = renderTreeView('hello')
      expect(html).toContain('"hello"')
      expect(html).not.toContain('undefined:')
    })

    test('renders nested arrays', () => {
      const arr = [
        [1, 2],
        [3, 4],
      ]
      const html = renderTreeView(arr, 'matrix')
      expect(html).toContain('matrix:')
      expect(html).toContain('[')
      expect(html).toContain('1')
      expect(html).toContain('4')
    })

    test('renders object with symbol values using JSON.stringify', () => {
      const obj = { sym: Symbol('test') }
      const html = renderTreeView(obj, 'data')
      expect(html).toContain('data:')
      // Symbol should be handled by JSON.stringify in formatPrimitive
      expect(html).toContain('tree-toggle')
    })

    test('renders mixed array with objects and primitives', () => {
      const arr = [{ nested: 'value' }, 'string', 42]
      const html = renderTreeView(arr)
      expect(html).toContain('nested:')
      expect(html).toContain('"string"')
      expect(html).toContain('42')
    })
  })

  describe('renderPropertiesTree', () => {
    test('renders empty object message', () => {
      const html = renderPropertiesTree({})
      expect(html).toContain('No properties')
    })

    test('renders properties in table', () => {
      const obj = {
        userId: 'user-123',
        count: 42,
        active: true,
      }
      const html = renderPropertiesTree(obj)
      expect(html).toContain('tree-table')
      expect(html).toContain('userId')
      expect(html).toContain('user-123')
      expect(html).toContain('count')
      expect(html).toContain('42')
    })

    test('renders nested objects in table cells', () => {
      const obj = {
        error: {
          code: 'ECONNREFUSED',
          message: 'Connection refused',
        },
      }
      const html = renderPropertiesTree(obj)
      expect(html).toContain('error')
      expect(html).toContain('ECONNREFUSED')
      expect(html).toContain('tree-toggle')
    })

    test('escapes HTML in property keys', () => {
      const obj = {
        '<script>': 'value',
      }
      const html = renderPropertiesTree(obj)
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>')
    })
  })
})
