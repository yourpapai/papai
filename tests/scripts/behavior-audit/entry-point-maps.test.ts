// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import {
  buildCommandMap,
  buildRouteMap,
  buildToolMap,
  type CommandCatalogFn,
  type RouteRegistryFn,
  type ToolRegistryFn,
} from '../../../scripts/behavior-audit/entry-point-maps.js'

describe('entry-point maps', () => {
  test('buildCommandMap returns Set of command identifiers from catalog', () => {
    const mockCatalog = mock<CommandCatalogFn>(() => [
      { name: 'config', description: 'Configure' },
      { name: 'help', description: 'Help' },
    ])
    const result = buildCommandMap(mockCatalog)
    expect(result.has('config')).toBe(true)
    expect(result.has('help')).toBe(true)
    expect(result.has('missing')).toBe(false)
  })

  test('buildCommandMap prefixes commands with /', () => {
    const mockCatalog = mock<CommandCatalogFn>(() => [{ name: 'config', description: '' }])
    const result = buildCommandMap(mockCatalog)
    expect(result.has('/config')).toBe(true)
    expect(result.has('config')).toBe(true)
  })

  test('buildToolMap returns empty Set when tool registry unavailable', () => {
    const registry = mock<ToolRegistryFn>(() => undefined)
    const result = buildToolMap(registry)
    expect(result.size).toBe(0)
  })

  test('buildRouteMap returns empty Set when routes module unavailable', () => {
    const registry = mock<RouteRegistryFn>(() => undefined)
    const result = buildRouteMap(registry)
    expect(result.size).toBe(0)
  })
})
