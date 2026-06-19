// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const PERMALINK_PATTERN = /\/pl\/([a-z0-9]+)\/?$/iu

/**
 * Return the Mattermost post id from a permalink, but only when the link's host
 * matches the instance baseUrl host and the path is a `/pl/<postId>` permalink.
 * Returns null otherwise. The URL is parsed for identifiers only — never fetched.
 */
export function parseMattermostPermalink(url: string, baseUrl: string): string | null {
  let parsed: URL
  let base: URL
  try {
    parsed = new URL(url)
    base = new URL(baseUrl)
  } catch {
    return null
  }
  if (parsed.host !== base.host) return null
  const match = PERMALINK_PATTERN.exec(parsed.pathname)
  if (match === null) return null
  return match[1] ?? null
}
