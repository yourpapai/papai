// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Field-keyed validation errors for an MCP endpoint draft. Empty object = valid. */
export interface McpEndpointErrors {
  url?: string
}

/**
 * Validate a user-entered MCP endpoint against the server contract
 * (`mcpEndpointConfigSchema`): the URL is required and must be a parseable
 * `https://` URL. Pure; no side effects.
 */
export function validateMcpEndpoint(endpoint: { url: string }): McpEndpointErrors {
  const url = endpoint.url.trim()
  if (url === '') return { url: 'URL is required.' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { url: 'URL must start with https://' }
  }
  if (parsed.protocol !== 'https:') return { url: 'URL must start with https://' }
  return {}
}
