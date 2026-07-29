// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Unicode letters and numbers only. Everything else — punctuation, whitespace,
// FTS5 operators — is a separator, so a token can never carry syntax into MATCH.
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

/** @public -- consumed by the lexical retrieval channel. */
export const tokenizeQuery = (text: string): readonly string[] => text.toLowerCase().match(TOKEN_PATTERN) ?? []

// Defense in depth: the token pattern already excludes `"`, but quoting is what
// makes the term a literal to FTS5 rather than an operator.
const escapeTerm = (token: string): string => `"${token.replace(/"/gu, '""')}"`

/**
 * Builds an FTS5 MATCH expression of quoted prefix terms joined by OR.
 * Prefix form is required because FTS5 does not stem: `"маршрут"*` matches
 * `Маршруты` and `маршруту`, while bare `маршрут` matches neither.
 * Returns null when the query contains no tokens, so callers can skip the
 * lexical channel instead of issuing a degenerate MATCH.
 * @public -- consumed by the lexical retrieval channel.
 */
export const buildFtsMatchQuery = (query: string): string | null => {
  const tokens = [...new Set(tokenizeQuery(query))]
  if (tokens.length === 0) return null
  return tokens.map((token) => `${escapeTerm(token)}*`).join(' OR ')
}
