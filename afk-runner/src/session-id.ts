// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const MAX_SLUG_LENGTH = 64

/**
 * Derive a filesystem-safe session id from a task title: lowercase ASCII
 * alphanumerics joined by single dashes, clamped to 64 characters. The id is
 * lossy by design — the full title lives verbatim in the run's task record.
 */
export function slugifySessionId(title: string): string {
  const ascii = title.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/gu, '')
  return slug
}
