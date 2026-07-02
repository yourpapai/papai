// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseLogFilter, type LogFilter } from '../../src/debug/log-filter-model.js'

export type { LogFilter } from '../../src/debug/log-filter-model.js'

export function emptyFilter(): LogFilter {
  return { include: [], exclude: [], level: 0 }
}

export function filterToParams(filter: LogFilter): URLSearchParams {
  const params = new URLSearchParams()
  for (const p of filter.include) params.append('include', p)
  for (const p of filter.exclude) params.append('exclude', p)
  if (filter.level > 0) params.set('level', String(filter.level))
  if (filter.turnId !== undefined && filter.turnId !== '') params.set('turnId', filter.turnId)
  if (filter.q !== undefined && filter.q !== '') params.set('q', filter.q)
  return params
}

export function filterToQuery(filter: LogFilter): string {
  return filterToParams(filter).toString()
}

/** Inverse of filterToParams; reuses the server parser for identical semantics. */
export function filterFromParams(params: URLSearchParams): LogFilter {
  return parseLogFilter(params)
}
