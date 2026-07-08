// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AdminMcpCatalogResponseSchema } from '../../../client/settings/fetcher-schemas-mcp-catalog.js'

describe('AdminMcpCatalogResponseSchema', () => {
  test('parses an empty catalog', () => {
    const parsed = AdminMcpCatalogResponseSchema.parse({ entries: [] })
    expect(parsed.entries).toEqual([])
  })

  test('parses a full entry with header, default policy, and per-tool policy', () => {
    const parsed = AdminMcpCatalogResponseSchema.parse({
      entries: [
        {
          name: 'Jira',
          upstream_url: 'https://mcp.atlassian.com/v1',
          host: 'mcp.atlassian.com',
          header: 'Authorization: Bearer xyz',
          default_tool_policy: 'allow',
          tool_policy: { search_issues: 'allow', delete_issue: 'deny' },
        },
      ],
    })
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toMatchObject({
      name: 'Jira',
      upstream_url: 'https://mcp.atlassian.com/v1',
      host: 'mcp.atlassian.com',
      header: 'Authorization: Bearer xyz',
      default_tool_policy: 'allow',
      tool_policy: { search_issues: 'allow', delete_issue: 'deny' },
    })
  })

  test('parses a minimal entry without optional fields', () => {
    const parsed = AdminMcpCatalogResponseSchema.parse({
      entries: [{ name: 'Jira', upstream_url: 'https://mcp.atlassian.com/v1', host: 'mcp.atlassian.com' }],
    })
    expect(parsed.entries[0]?.header).toBeUndefined()
    expect(parsed.entries[0]?.default_tool_policy).toBeUndefined()
    expect(parsed.entries[0]?.tool_policy).toBeUndefined()
  })

  test('throws when entries is missing', () => {
    expect(() => AdminMcpCatalogResponseSchema.parse({})).toThrow()
  })

  test('throws when an entry has an invalid tool policy value', () => {
    expect(() =>
      AdminMcpCatalogResponseSchema.parse({
        entries: [
          {
            name: 'Jira',
            upstream_url: 'https://mcp.atlassian.com/v1',
            host: 'mcp.atlassian.com',
            default_tool_policy: 'sometimes',
          },
        ],
      }),
    ).toThrow()
  })
})
