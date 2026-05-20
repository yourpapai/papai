// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getGlobalStats, getSubjectStats } from '../stats/index.js'
import type { StatsWindow } from '../stats/types.js'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const isStatsWindow = (value: string): value is StatsWindow =>
  value === '1d' || value === '7d' || value === '30d' || value === 'all'

const parseStatsWindow = (raw: string | null): StatsWindow | null => {
  if (raw === null) return '30d'
  return isStatsWindow(raw) ? raw : null
}

export const handleStatsGlobal = (url: URL): Response => {
  const window = parseStatsWindow(url.searchParams.get('window'))
  if (window === null) return jsonResponse(400, { error: 'unknown window' })
  const stats = getGlobalStats({ window })
  return jsonResponse(200, stats)
}

export const handleStatsSubject = (url: URL): Response => {
  const rawId = url.pathname.slice('/stats/subject/'.length)
  if (rawId === '') return jsonResponse(400, { error: 'missing subject id' })
  const subjectId = decodeURIComponent(rawId)
  const stats = getSubjectStats(subjectId)
  if (stats === null) return jsonResponse(404, { error: 'subject not found' })
  return jsonResponse(200, stats)
}
