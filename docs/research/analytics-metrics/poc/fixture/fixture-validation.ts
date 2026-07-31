// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  ACTOR_ROLES,
  CONTEXT_TYPES,
  EVENT_PROP_ALLOWLIST,
  INTENT_V1_LABELS,
  INVOCATION_MODES,
  PLATFORMS,
  TASK_PROVIDERS,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from './fixture-contract.js'

type ValidationResult = Readonly<{ ok: true }> | Readonly<{ ok: false; violations: readonly string[] }>

const FORBIDDEN_PROP_KEYS = new Set([
  'api_key',
  'arguments',
  'attachment_filename',
  'body',
  'content',
  'display_name',
  'file_name',
  'filename',
  'memo_body',
  'message',
  'message_text',
  'password',
  'path',
  'project_name',
  'prompt',
  'provider_object_name',
  'rrule',
  'secret',
  'session_cookie',
  'status_name',
  'tag_name',
  'text',
  'token',
  'tool_args',
  'url',
  'username',
  'workspace_name',
])

const SAFE_VALUE_PATTERN = /^[a-z0-9][-a-z0-9_.:]{0,95}$/u
const PSEUDONYM_PATTERN = /^syn_[0-9a-f]{32}$/u
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/u
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const FORBIDDEN_VALUE_PATTERNS = [
  /(?:https?|ftp):\/\//iu,
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/iu,
  /\bsk-[a-z0-9_-]{8,}/iu,
  /(?:^|\s)(?:\/[a-z0-9_.-]+){2,}/iu,
] as const

const INTENT_LABEL_SET: ReadonlySet<string> = new Set(INTENT_V1_LABELS)
const PLATFORM_SET: ReadonlySet<string> = new Set(PLATFORMS)
const CONTEXT_SET: ReadonlySet<string> = new Set(CONTEXT_TYPES)
const ROLE_SET: ReadonlySet<string> = new Set(ACTOR_ROLES)
const PROVIDER_SET: ReadonlySet<string> = new Set(TASK_PROVIDERS)
const INVOCATION_SET: ReadonlySet<string> = new Set(INVOCATION_MODES)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isEventName = (value: string): value is AnalyticsEventName => Object.hasOwn(EVENT_PROP_ALLOWLIST, value)

const isSafeString = (value: string): boolean =>
  (SAFE_VALUE_PATTERN.test(value) || UTC_DAY_PATTERN.test(value)) &&
  FORBIDDEN_VALUE_PATTERNS.every((pattern) => !pattern.test(value))

const isCanonicalGoals = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= 3 &&
  value.every((entry) => typeof entry === 'string' && INTENT_LABEL_SET.has(entry))

function valueViolations(property: string, value: unknown): readonly string[] {
  if (value === null || typeof value === 'boolean') return []
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? [] : [`property ${property} must be a non-negative safe integer`]
  }
  if (typeof value === 'string') {
    return isSafeString(value) ? [] : [`forbidden content-like value for property ${property}`]
  }
  if (isCanonicalGoals(value)) {
    const sorted = value.toSorted((left, right) => left.localeCompare(right))
    const valid = new Set(value).size === value.length && JSON.stringify(value) === JSON.stringify(sorted)
    return valid ? [] : [`property ${property} must be a sorted unique intent.v1 array of at most three labels`]
  }
  return [`property ${property} has a nested or unsupported value`]
}

export function validateStoredProps(eventName: string, value: unknown): readonly string[] {
  if (!isEventName(eventName)) return [`unknown event name ${eventName}`]
  if (!isRecord(value)) return ['props_json must be an object']
  const allowed = new Set<string>(EVENT_PROP_ALLOWLIST[eventName])
  return [
    ...Object.keys(value).flatMap((property) => {
      if (FORBIDDEN_PROP_KEYS.has(property)) return [`forbidden property key ${property}`]
      if (!allowed.has(property)) return [`property ${property} is not allowed for ${eventName}`]
      return valueViolations(property, value[property])
    }),
    ...[...allowed]
      .filter((property) => !Object.hasOwn(value, property))
      .map((property) => `required property ${property} is missing for ${eventName}`),
  ]
}

function identityViolations(event: AnalyticsEvent): readonly string[] {
  const pseudonyms = [
    event.deploymentKey,
    event.platformInstanceKey,
    event.actorKey,
    event.contextKey,
    event.threadKey,
    event.taskInstanceKey,
    event.turnKey,
    event.sessionKey,
  ].filter((value): value is string => value !== null)
  const guestKeys = [
    event.actorKey,
    event.contextKey,
    event.threadKey,
    event.taskInstanceKey,
    event.turnKey,
    event.sessionKey,
  ]
  const guestContinuity = event.eventName === 'guest_turn_aggregate' && guestKeys.some((value) => value !== null)
  return [
    ...(pseudonyms.every((value) => PSEUDONYM_PATTERN.test(value)) ? [] : ['invalid synthetic pseudonym']),
    ...(guestContinuity ? ['guest aggregate carries prohibited longitudinal continuity'] : []),
  ]
}

function envelopeViolations(event: AnalyticsEvent): readonly string[] {
  const timestampValid =
    Number.isSafeInteger(event.occurredAtMs) &&
    Number.isSafeInteger(event.ingestedAtMs) &&
    event.ingestedAtMs >= event.occurredAtMs &&
    Number.isSafeInteger(event.expiresAtMs) &&
    event.expiresAtMs > event.occurredAtMs
  const dimensionsValid =
    PLATFORM_SET.has(event.platform) &&
    CONTEXT_SET.has(event.contextType) &&
    ROLE_SET.has(event.actorRole) &&
    PROVIDER_SET.has(event.taskProvider) &&
    INVOCATION_SET.has(event.invocationMode)
  const invalidGuestEnvelope =
    event.eventName === 'guest_turn_aggregate' &&
    (event.collectionTier !== 'aggregate' ||
      event.eligibility !== 'not_applicable' ||
      event.privacyMaxClass !== 'C0' ||
      event.contextType !== 'none' ||
      event.actorRole !== 'guest')
  return [
    ...(EVENT_ID_PATTERN.test(event.eventId) ? [] : ['invalid event_id']),
    ...(timestampValid ? [] : ['invalid event timestamps']),
    ...(dimensionsValid ? [] : ['invalid canonical dimension']),
    ...(invalidGuestEnvelope ? ['invalid aggregate guest envelope'] : []),
    ...identityViolations(event),
  ]
}

export function validateContentFreeEvents(events: readonly AnalyticsEvent[]): ValidationResult {
  const violations = events.flatMap((event) => [
    ...envelopeViolations(event).map((violation) => `${event.eventId}: ${violation}`),
    ...validateStoredProps(event.eventName, event.props).map((violation) => `${event.eventId}: ${violation}`),
  ])
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}

export const propsJson = (event: AnalyticsEvent): string => JSON.stringify(event.props)
