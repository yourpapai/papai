// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import * as legacyCatalog from '../../../src/coding-credentials/mcp-catalog.js'
import * as legacySelections from '../../../src/coding-credentials/mcp-selections.js'
import * as legacyResolver from '../../../src/coding-credentials/resolve-mcp-servers.js'
import * as moduleCatalog from '../../../src/modules/coding/credentials/mcp-catalog.js'
import * as moduleSelections from '../../../src/modules/coding/credentials/mcp-selections.js'
import * as moduleResolver from '../../../src/modules/coding/credentials/resolve-mcp-servers.js'

describe('legacy coding credential facades', () => {
  test('re-export MCP catalog APIs from the coding module', () => {
    expect(legacyCatalog.setMcpCatalog).toBe(moduleCatalog.setMcpCatalog)
    expect(legacyCatalog.resolveMcpCatalog).toBe(moduleCatalog.resolveMcpCatalog)
  })

  test('re-export MCP selection APIs from the coding module', () => {
    expect(legacySelections.serializeMcpSelections).toBe(moduleSelections.serializeMcpSelections)
    expect(legacySelections.parseMcpSelections).toBe(moduleSelections.parseMcpSelections)
  })

  test('re-exports the MCP resolver from the coding module', () => {
    expect(legacyResolver.resolveMcpServers).toBe(moduleResolver.resolveMcpServers)
  })
})
