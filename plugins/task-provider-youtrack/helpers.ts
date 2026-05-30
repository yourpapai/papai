// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { youtrackFetch } from './client.js'
import type { YouTrackConfig, YouTrackQueryValue } from './client.js'

// --- Duration helpers ---

/**
 * Parse a natural or ISO-8601 duration string into a normalised ISO-8601 string.
 *
 * Accepts: "2h 30m", "1.5h", "90m", "2h30m", "PT2H30M"
 * Returns: "PT2H30M"
 */
export function parseDuration(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') {
    throw new Error('Duration cannot be empty')
  }

  // Already ISO-8601 duration
  if (/^PT/iu.test(trimmed)) {
    const normalized = trimmed.toUpperCase()
    void isoToMinutes(normalized)
    return normalized
  }

  let totalMinutes = 0

  // Match "Xh Ym" or "Xh" or "Ym" with optional decimal on hours
  const combined = trimmed.replace(/\s+/gu, '')
  const hoursMinutesMatch = combined.match(/^(\d+(?:\.\d+)?)[hH](?:(\d+)[mM])?$/u)
  if (hoursMinutesMatch !== null) {
    const hours = parseFloat(hoursMinutesMatch[1] ?? '0')
    const minutes = parseInt(hoursMinutesMatch[2] ?? '0', 10)
    totalMinutes = Math.round(hours * 60) + minutes
    return minutesToIso(totalMinutes)
  }

  // Match pure minutes "Xm"
  const minutesOnlyMatch = combined.match(/^(\d+)[mM]$/u)
  if (minutesOnlyMatch !== null) {
    totalMinutes = parseInt(minutesOnlyMatch[1] ?? '0', 10)
    return minutesToIso(totalMinutes)
  }

  throw new Error(`Unsupported duration format: "${input}"`)
}

/**
 * Convert a total number of minutes to an ISO-8601 duration string.
 * e.g. 90 → "PT1H30M", 60 → "PT1H", 30 → "PT30M"
 */
export function minutesToIso(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `PT${h}H${m}M`
  if (h > 0) return `PT${h}H`
  return `PT${m}M`
}

/**
 * Convert an ISO-8601 duration string to total minutes.
 * e.g. "PT2H30M" → 150, "PT1H" → 60, "PT30M" → 30
 */
export function isoToMinutes(iso: string): number {
  const match = iso.toUpperCase().match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/u)
  if (match === null || (match[1] === undefined && match[2] === undefined)) {
    throw new Error(`Invalid ISO-8601 duration: "${iso}"`)
  }
  const hours = parseInt(match[1] ?? '0', 10)
  const mins = parseInt(match[2] ?? '0', 10)
  return hours * 60 + mins
}

// --- Pagination ---

/**
 * Paginate a YouTrack collection endpoint using $top/$skip.
 *
 * Fetches pages of `pageSize` items until fewer than `pageSize` items are
 * returned or `maxPages` is reached, then returns all collected items.
 */
export function paginate<T>(
  config: YouTrackConfig,
  path: string,
  query: Record<string, YouTrackQueryValue>,
  schema: z.ZodType<T[]>,
  maxPages = 10,
  pageSize = 100,
  initialSkip = 0,
): Promise<T[]> {
  return paginatePage(config, path, query, schema, maxPages, pageSize, initialSkip, initialSkip, [])
}

async function paginatePage<T>(
  config: YouTrackConfig,
  path: string,
  query: Record<string, YouTrackQueryValue>,
  schema: z.ZodType<T[]>,
  maxPages: number,
  pageSize: number,
  initialSkip: number,
  skip: number,
  accumulated: T[],
): Promise<T[]> {
  if (skip - initialSkip >= maxPages * pageSize) return accumulated

  const pageQuery: Record<string, YouTrackQueryValue> = {
    ...query,
    $top: String(pageSize),
    $skip: String(skip),
  }

  const raw = await youtrackFetch(config, 'GET', path, { query: pageQuery })
  const items = schema.parse(raw)
  const all = [...accumulated, ...items]

  if (items.length < pageSize) return all
  return paginatePage(config, path, query, schema, maxPages, pageSize, initialSkip, skip + pageSize, all)
}

// --- Work item type resolution ---

const WorkItemTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
})

/**
 * Resolve a work item type name to its stable ID.
 *
 * Queries project-level types when `projectId` is provided, falls back to
 * global types otherwise. Returns `undefined` if the name cannot be matched.
 */
export async function resolveWorkItemTypeId(
  config: YouTrackConfig,
  nameOrId: string,
  projectId?: string,
): Promise<string | undefined> {
  const path =
    projectId === undefined
      ? '/api/admin/timeTrackingSettings/workItemTypes'
      : `/api/admin/projects/${projectId}/timeTrackingSettings/workItemTypes`

  const raw = await youtrackFetch(config, 'GET', path, { query: { fields: 'id,name' } })
  const types = WorkItemTypeSchema.array().parse(raw)
  const lower = nameOrId.toLowerCase()
  const found = types.find((t) => t.id === nameOrId || t.name.toLowerCase() === lower)
  return found?.id
}
