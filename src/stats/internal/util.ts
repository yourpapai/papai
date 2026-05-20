// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const parseIsoToMs = (value: string | null): number | null => {
  if (value === null || value === '') return null
  const trimmed = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
  const ms = Date.parse(trimmed)
  return Number.isFinite(ms) ? ms : null
}

export const safeParseTags = (raw: string): readonly string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const v of parsed) if (typeof v === 'string') out.push(v)
    return out
  } catch {
    return []
  }
}
