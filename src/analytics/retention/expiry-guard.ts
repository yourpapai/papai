// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { gt } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { analyticsEvents } from '../../db/schema.js'
import { V1_MAX_EVENT_RETENTION_DAYS } from '../governance/generation-store.js'

export const DAY_MS = 86_400_000
export const MINUTE_MS = 60_000

export const RETENTION_MAXIMA = {
  canonicalEventDays: V1_MAX_EVENT_RETENTION_DAYS,
  pendingDeliveryDays: 14,
  deliveryReceiptDays: 30,
  externalPseudonymousSinkDays: 90,
  assessedRollupDays: 400,
  supersededGovernanceAuditDays: 400,
  rephraseFeatureSetMinutes: 30,
} as const

export type RetentionLimits = Readonly<{
  canonicalEventDays: number
  pendingDeliveryDays: number
  deliveryReceiptDays: number
  assessedRollupDays: number
  supersededGovernanceAuditDays: number
}>

export const DEFAULT_RETENTION_LIMITS: RetentionLimits = {
  canonicalEventDays: RETENTION_MAXIMA.canonicalEventDays,
  pendingDeliveryDays: RETENTION_MAXIMA.pendingDeliveryDays,
  deliveryReceiptDays: RETENTION_MAXIMA.deliveryReceiptDays,
  assessedRollupDays: RETENTION_MAXIMA.assessedRollupDays,
  supersededGovernanceAuditDays: RETENTION_MAXIMA.supersededGovernanceAuditDays,
}

const MAXIMA_BY_FIELD: Readonly<Record<keyof RetentionLimits, number>> = {
  canonicalEventDays: RETENTION_MAXIMA.canonicalEventDays,
  pendingDeliveryDays: RETENTION_MAXIMA.pendingDeliveryDays,
  deliveryReceiptDays: RETENTION_MAXIMA.deliveryReceiptDays,
  assessedRollupDays: RETENTION_MAXIMA.assessedRollupDays,
  supersededGovernanceAuditDays: RETENTION_MAXIMA.supersededGovernanceAuditDays,
}

export class RetentionLimitExceededError extends Error {
  constructor(field: string, value: number, maximum: number) {
    super(`retention ${field}=${value} exceeds the fixed maximum of ${maximum} days`)
    this.name = 'RetentionLimitExceededError'
  }
}

const checkDownward = (field: keyof RetentionLimits, value: number): void => {
  const maximum = MAXIMA_BY_FIELD[field]
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RetentionLimitExceededError(field, value, maximum)
  }
}

const RETENTION_LIMIT_FIELDS = [
  'canonicalEventDays',
  'pendingDeliveryDays',
  'deliveryReceiptDays',
  'assessedRollupDays',
  'supersededGovernanceAuditDays',
] as const satisfies readonly (keyof RetentionLimits)[]

export const resolveRetentionLimits = (overrides: Partial<RetentionLimits> = {}): RetentionLimits => {
  const resolved: Record<keyof RetentionLimits, number> = { ...DEFAULT_RETENTION_LIMITS }
  for (const field of RETENTION_LIMIT_FIELDS) {
    const value = overrides[field]
    if (value === undefined) continue
    checkDownward(field, value)
    resolved[field] = value
  }
  return resolved
}

export const isUnexpired = (nowMs: number, expiresAtMs: number): boolean => expiresAtMs > nowMs

export const unexpiredEventFilter = (nowMs: number): SQL => gt(analyticsEvents.expiresAtMs, nowMs)

export const canonicalEventExpiryMs = (
  occurredAtMs: number,
  limits: RetentionLimits = DEFAULT_RETENTION_LIMITS,
): number => occurredAtMs + limits.canonicalEventDays * DAY_MS

export const pendingDeliveryDeadlineMs = (
  event: Readonly<{ occurredAtMs: number; expiresAtMs: number }>,
  limits: RetentionLimits = DEFAULT_RETENTION_LIMITS,
): number => Math.min(event.expiresAtMs, event.occurredAtMs + limits.pendingDeliveryDays * DAY_MS)

export const deliveryReceiptDeadlineMs = (
  settledAtMs: number,
  limits: RetentionLimits = DEFAULT_RETENTION_LIMITS,
): number => settledAtMs + limits.deliveryReceiptDays * DAY_MS

const UTC_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u

export const utcDayStartMs = (utcDay: string): number => {
  const match = UTC_DAY_PATTERN.exec(utcDay)
  if (match === null) throw new Error(`invalid utcDay: ${utcDay}`)
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(ms)) throw new Error(`invalid utcDay: ${utcDay}`)
  return ms
}

export const aggregateDeadlineMs = (
  utcDay: string,
  assessed: boolean,
  limits: RetentionLimits = DEFAULT_RETENTION_LIMITS,
): number =>
  utcDayStartMs(utcDay) + DAY_MS + (assessed ? limits.assessedRollupDays : limits.canonicalEventDays) * DAY_MS

export const nextUtcDayStartMs = (nowMs: number): number =>
  utcDayStartMs(new Date(nowMs).toISOString().slice(0, 10)) + DAY_MS

export const pendingAggregateDeliveryDeadlineMs = (
  utcDay: string,
  limits: RetentionLimits = DEFAULT_RETENTION_LIMITS,
): number => utcDayStartMs(utcDay) + DAY_MS + limits.pendingDeliveryDays * DAY_MS

export const governanceAuditDeadlineMs = (
  occurredAtMs: number,
  limits: RetentionLimits = DEFAULT_RETENTION_LIMITS,
): number => occurredAtMs + limits.supersededGovernanceAuditDays * DAY_MS
