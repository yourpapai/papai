// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Activity, Agile, SavedQuery, Sprint } from 'papai/plugin-types'

import type { YouTrackActivity } from './schemas/activity.js'
import type { YouTrackAgile } from './schemas/agile.js'
import type { YouTrackSavedQuery } from './schemas/saved-query.js'
import type { YouTrackSprint } from './schemas/sprint.js'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const getStringProperty = (record: Record<string, unknown>, key: string): string | undefined => {
  const property = record[key]
  return typeof property === 'string' ? property : undefined
}

const stringifyUnknown = (value: unknown): string | undefined => {
  const json = JSON.stringify(value)
  return json ?? undefined
}

const activityValueToString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    const parts = value.map(activityValueToString).filter((part): part is string => part !== undefined)
    return parts.length === 0 ? undefined : parts.join(', ')
  }
  if (!isRecord(value)) return undefined
  return (
    getStringProperty(value, 'name') ??
    getStringProperty(value, 'presentation') ??
    getStringProperty(value, 'text') ??
    stringifyUnknown(value)
  )
}

export const mapAgile = (agile: YouTrackAgile): Agile => ({
  id: agile.id,
  name: agile.name,
})

export const mapSprint = (sprint: YouTrackSprint, agileId: string): Sprint => ({
  id: sprint.id,
  agileId,
  name: sprint.name,
  start: sprint.start !== undefined && sprint.start !== null ? new Date(sprint.start).toISOString() : undefined,
  finish: sprint.finish !== undefined && sprint.finish !== null ? new Date(sprint.finish).toISOString() : undefined,
  archived: sprint.archived ?? false,
  goal: sprint.goal,
  isDefault: sprint.isDefault,
  unresolvedIssuesCount: sprint.unresolvedIssuesCount,
})

export const mapActivity = (activity: YouTrackActivity): Activity => ({
  id: activity.id,
  timestamp: new Date(activity.timestamp).toISOString(),
  author: activity.author?.fullName ?? activity.author?.name ?? activity.author?.login ?? undefined,
  category: activity.category?.id ?? 'Unknown',
  field: activity.field?.name ?? activity.targetMember ?? undefined,
  added: activityValueToString(activity.added),
  removed: activityValueToString(activity.removed),
})

export const mapSavedQuery = (query: YouTrackSavedQuery): SavedQuery => ({
  id: query.id,
  name: query.name,
  query: query.query,
})
