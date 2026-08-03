// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  ACTOR_ROLES,
  CONTEXT_TYPES,
  EVENT_PROP_ALLOWLIST,
  INVOCATION_MODES,
  PLATFORMS,
  TASK_PROVIDERS,
  type AnalyticsEventName,
  type EventProps,
  type JsonScalar,
} from '../fixture/fixture-contract.js'
import { validateStoredProps } from '../fixture/fixture-validation.js'
import { validateControlledEventProps } from './property-domains.js'

export interface CanonicalEventRow {
  readonly event_id: string
  readonly schema_name: string
  readonly schema_version: number
  readonly event_version: number
  readonly occurred_at_ms: number
  readonly ingested_at_ms: number
  readonly event_name: string
  readonly event_source: string
  readonly attribution_quality: string
  readonly app_version: string
  readonly deployment_key: string
  readonly key_version: number
  readonly platform: string
  readonly platform_instance_key: string
  readonly actor_key: string | null
  readonly context_key: string | null
  readonly thread_key: string | null
  readonly task_instance_key: string | null
  readonly context_type: string
  readonly actor_role: string
  readonly task_provider: string
  readonly invocation_mode: string
  readonly turn_key: string | null
  readonly session_key: string | null
  readonly governance_purpose: string
  readonly collection_tier: string
  readonly policy_version: number
  readonly eligibility: string
  readonly privacy_max_class: string
  readonly expires_at_ms: number
  readonly props_json: string
}

export type OpenPanelPropertyValue = JsonScalar | readonly string[]
export type OpenPanelProperties = Readonly<Record<string, OpenPanelPropertyValue>>

export interface OpenPanelTrackRequest {
  readonly type: 'track'
  readonly payload: Readonly<{
    name: AnalyticsEventName
    profileId?: string
    properties: OpenPanelProperties
  }>
}

export interface MappedCanonicalEvent {
  readonly eventId: string
  readonly request: OpenPanelTrackRequest
}

export type MappingResult =
  | Readonly<{ ok: true; value: MappedCanonicalEvent }>
  | Readonly<{ ok: false; violations: readonly string[] }>

const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/u
const PSEUDONYM_PATTERN = /^syn_[0-9a-f]{32}$/u
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/u

const allowed = (values: readonly string[], value: string): boolean => values.includes(value)
const isEventName = (value: string): value is AnalyticsEventName => Object.hasOwn(EVENT_PROP_ALLOWLIST, value)
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isPropertyValue = (value: unknown): value is OpenPanelPropertyValue =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'number' ||
  typeof value === 'string' ||
  (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
const isEventProps = (value: unknown): value is EventProps =>
  isRecord(value) && Object.values(value).every(isPropertyValue)

function constantViolations(row: CanonicalEventRow): readonly string[] {
  return [
    ...(row.schema_name === 'papai.analytics.event' ? [] : ['schema_name must be papai.analytics.event']),
    ...(row.schema_version === 1 ? [] : ['schema_version must be 1']),
    ...(row.event_version === 1 ? [] : ['event_version must be 1']),
    ...(row.key_version === 1 ? [] : ['key_version must be 1']),
    ...(row.governance_purpose === 'product_analytics' ? [] : ['invalid governance_purpose']),
    ...(row.policy_version === 1 ? [] : ['policy_version must be 1']),
  ]
}

function timestampViolations(row: CanonicalEventRow): readonly string[] {
  const timestampsAreIntegers = [row.occurred_at_ms, row.ingested_at_ms, row.expires_at_ms].every((value) =>
    Number.isSafeInteger(value),
  )
  const orderingIsValid = row.ingested_at_ms >= row.occurred_at_ms && row.expires_at_ms > row.occurred_at_ms
  const dateIsValid = !Number.isNaN(new Date(row.occurred_at_ms).getTime())
  return timestampsAreIntegers && orderingIsValid && dateIsValid ? [] : ['invalid canonical timestamps']
}

function dimensionViolations(row: CanonicalEventRow): readonly string[] {
  return [
    ...(allowed(PLATFORMS, row.platform) ? [] : ['invalid platform']),
    ...(allowed(CONTEXT_TYPES, row.context_type) ? [] : ['invalid context_type']),
    ...(allowed(ACTOR_ROLES, row.actor_role) ? [] : ['invalid actor_role']),
    ...(allowed(TASK_PROVIDERS, row.task_provider) ? [] : ['invalid task_provider']),
    ...(allowed(INVOCATION_MODES, row.invocation_mode) ? [] : ['invalid invocation_mode']),
    ...(allowed(['live', 'backfill'], row.event_source) ? [] : ['invalid event_source']),
    ...(allowed(['native', 'backfill_snapshot', 'unknown'], row.attribution_quality)
      ? []
      : ['invalid attribution_quality']),
    ...(allowed(['aggregate', 'pseudonymous'], row.collection_tier) ? [] : ['invalid collection_tier']),
    ...(allowed(['allowed', 'operator_basis', 'not_applicable'], row.eligibility) ? [] : ['invalid eligibility']),
    ...(allowed(['C0', 'C1', 'C2'], row.privacy_max_class) ? [] : ['invalid privacy_max_class']),
  ]
}

function identityViolations(row: CanonicalEventRow): readonly string[] {
  const pseudonyms = [
    row.deployment_key,
    row.platform_instance_key,
    row.actor_key,
    row.context_key,
    row.thread_key,
    row.task_instance_key,
    row.turn_key,
    row.session_key,
  ].filter((value): value is string => value !== null)
  const continuity = [
    row.actor_key,
    row.context_key,
    row.thread_key,
    row.task_instance_key,
    row.turn_key,
    row.session_key,
  ]
  const profileEligible = row.collection_tier === 'pseudonymous' && ['admin', 'member'].includes(row.actor_role)
  const aggregateContinuity = row.collection_tier === 'aggregate' && continuity.some((value) => value !== null)
  return [
    ...(pseudonyms.every((value) => PSEUDONYM_PATTERN.test(value)) ? [] : ['invalid synthetic pseudonym']),
    ...(profileEligible && row.actor_key === null ? ['eligible pseudonymous row requires actor_key'] : []),
    ...(aggregateContinuity ? ['aggregate row carries longitudinal continuity'] : []),
    ...(row.actor_role === 'guest' && continuity.some((value) => value !== null)
      ? ['guest row carries longitudinal continuity']
      : []),
  ]
}

function parseProperties(row: CanonicalEventRow): Readonly<{ props?: EventProps; violations: readonly string[] }> {
  try {
    const parsed: unknown = JSON.parse(row.props_json)
    const violations = validateStoredProps(row.event_name, parsed)
    if (violations.length > 0) return { violations }
    if (!isEventProps(parsed)) return { violations: ['props_json has unsupported values'] }
    if (!isEventName(row.event_name)) return { violations: [`unknown event name ${row.event_name}`] }
    return { props: parsed, violations: validateControlledEventProps(row.event_name, parsed) }
  } catch {
    return { violations: ['props_json must be valid JSON'] }
  }
}

function envelopeProperties(row: CanonicalEventRow): OpenPanelProperties {
  return {
    __timestamp: new Date(row.occurred_at_ms).toISOString(),
    actor_role: row.actor_role,
    app_version: row.app_version,
    attribution_quality: row.attribution_quality,
    collection_tier: row.collection_tier,
    context_type: row.context_type,
    event_id: row.event_id,
    event_source: row.event_source,
    event_version: row.event_version,
    invocation_mode: row.invocation_mode,
    platform: row.platform,
    privacy_max_class: row.privacy_max_class,
    schema_version: row.schema_version,
    task_provider: row.task_provider,
    ...(row.session_key === null ? {} : { papai_session_key: row.session_key }),
    ...(row.turn_key === null ? {} : { papai_turn_key: row.turn_key }),
  }
}

function rowViolations(row: CanonicalEventRow): readonly string[] {
  return [
    ...(EVENT_ID_PATTERN.test(row.event_id) ? [] : ['invalid event_id']),
    ...(APP_VERSION_PATTERN.test(row.app_version) ? [] : ['invalid app_version']),
    ...(isEventName(row.event_name) ? [] : [`unknown event name ${row.event_name}`]),
    ...constantViolations(row),
    ...timestampViolations(row),
    ...dimensionViolations(row),
    ...identityViolations(row),
  ]
}

export function mapCanonicalRow(row: CanonicalEventRow): MappingResult {
  const props = parseProperties(row)
  const violations = [...rowViolations(row), ...props.violations]
  if (violations.length > 0 || props.props === undefined || !isEventName(row.event_name)) {
    return { ok: false, violations }
  }
  const profileEligible = row.collection_tier === 'pseudonymous' && ['admin', 'member'].includes(row.actor_role)
  return {
    ok: true,
    value: {
      eventId: row.event_id,
      request: {
        type: 'track',
        payload: {
          name: row.event_name,
          ...(profileEligible && row.actor_key !== null ? { profileId: row.actor_key } : {}),
          properties: { ...envelopeProperties(row), ...props.props },
        },
      },
    },
  }
}
