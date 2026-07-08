// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type Permission = 'allow' | 'ask' | 'deny'
interface PolicyRow {
  tool: string
  permission: Permission
}

function named(rows: PolicyRow[], permission: Permission): string[] {
  return rows.filter((r) => r.tool.trim() !== '' && r.permission === permission).map((r) => r.tool.trim())
}

export function describeMcpPosture(defaultPolicy: Permission, rows: PolicyRow[]): string {
  if (defaultPolicy === 'allow') {
    const parts: string[] = []
    const denied = named(rows, 'deny')
    const asked = named(rows, 'ask')
    if (denied.length > 0) parts.push(`blocked: ${denied.join(', ')}`)
    if (asked.length > 0) parts.push(`flagged: ${asked.join(', ')}`)
    return parts.length === 0 ? 'All tools allowed.' : `All tools allowed, except — ${parts.join('; ')}.`
  }
  if (defaultPolicy === 'deny') {
    const parts: string[] = []
    const allowed = named(rows, 'allow')
    const asked = named(rows, 'ask')
    if (allowed.length > 0) parts.push(`allowed: ${allowed.join(', ')}`)
    if (asked.length > 0) parts.push(`flagged: ${asked.join(', ')}`)
    return parts.length === 0
      ? '⚠ No tools allowed on this server.'
      : `Only these tools — ${parts.join('; ')} — all others blocked.`
  }
  const parts: string[] = []
  const allowed = named(rows, 'allow')
  const denied = named(rows, 'deny')
  if (allowed.length > 0) parts.push(`allowed: ${allowed.join(', ')}`)
  if (denied.length > 0) parts.push(`blocked: ${denied.join(', ')}`)
  const suffix = parts.length === 0 ? '' : ` Except — ${parts.join('; ')}.`
  return `Every tool call is allowed but flagged for review (ask).${suffix}`
}
