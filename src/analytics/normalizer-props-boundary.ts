// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsEventV1 } from './contracts.js'
import { propsByEventName } from './event-props.js'
import {
  nonNegativeInt,
  parseEnum,
  propsOk,
  propsRejected,
  readNonEmptyString,
  readNullableBool,
} from './normalizer-shared.js'
import type { FactKeyDeriver, PropsBuildResult, ValidatedFactRecord } from './normalizer-shared.js'

type Props = AnalyticsEventV1['props']
type Result = PropsBuildResult<Props>

const buildConfigLinkIssued = (fact: ValidatedFactRecord): Result => {
  const result = parseEnum(propsByEventName.config_link_issued.shape.result, fact['result'])
  if (result === null) return propsRejected('unknown_enum')
  return propsOk({ result })
}

const buildSettingsOpened = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.settings_opened.shape
  const entry = parseEnum(shape.entry, fact['entry'])
  const result = parseEnum(shape.result, fact['result'])
  if (entry === null || result === null) return propsRejected('unknown_enum')
  return propsOk({ entry, result })
}

const buildTaskInstanceAssigned = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.task_instance_assigned.shape
  const change = parseEnum(shape.change, fact['change'])
  const fromProvider = parseEnum(shape.from_provider, fact['fromProvider'])
  const toProvider = parseEnum(shape.to_provider, fact['toProvider'])
  if (change === null || fromProvider === null || toProvider === null) return propsRejected('unknown_enum')
  return propsOk({ change, from_provider: fromProvider, to_provider: toProvider })
}

const buildProviderRequestCompleted = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.provider_request_completed.shape
  const provider = parseEnum(shape.provider, fact['provider'])
  const operation = parseEnum(shape.operation, fact['operation'])
  const outcome = parseEnum(shape.outcome, fact['outcome'])
  const statusClass = parseEnum(shape.status_class, fact['statusClass'])
  if (provider === null || operation === null || outcome === null || statusClass === null) {
    return propsRejected('unknown_enum')
  }
  const durationMs = nonNegativeInt(fact['durationMs'])
  const retryable = readNullableBool(fact['retryable'])
  if (durationMs === null || retryable === undefined) return propsRejected('invalid_value')
  return propsOk({
    provider,
    operation,
    duration_ms: durationMs,
    outcome,
    status_class: statusClass,
    retryable,
  })
}

const buildRateLimitBlocked = (fact: ValidatedFactRecord): Result => {
  const limit = parseEnum(propsByEventName.rate_limit_blocked.shape.limit, fact['limit'])
  if (limit === null) return propsRejected('unknown_enum')
  return propsOk({ limit })
}

const buildUnconfiguredReply = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.unconfigured_reply.shape
  const missing = parseEnum(shape.missing, fact['missing'])
  const surface = parseEnum(shape.surface, fact['surface'])
  if (missing === null || surface === null) return propsRejected('unknown_enum')
  return propsOk({ missing, surface })
}

const buildMcpAvailability = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  const shape = propsByEventName.mcp_availability.shape
  const origin = parseEnum(shape.origin, fact['origin'])
  const outcome = parseEnum(shape.outcome, fact['outcome'])
  if (origin === null || outcome === null) return propsRejected('unknown_enum')
  const serverRawId = readNonEmptyString(fact['serverRawId'])
  if (serverRawId === null) return propsRejected('invalid_value')
  return propsOk({ origin, server_key: keys.serverKey(serverRawId), outcome })
}

export const buildBoundaryFamilyProps = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  switch (fact.type) {
    case 'config_link_issued':
      return buildConfigLinkIssued(fact)
    case 'settings_opened':
      return buildSettingsOpened(fact)
    case 'task_instance_assigned':
      return buildTaskInstanceAssigned(fact)
    case 'provider_request_completed':
      return buildProviderRequestCompleted(fact)
    case 'rate_limit_blocked':
      return buildRateLimitBlocked(fact)
    case 'unconfigured_reply':
      return buildUnconfiguredReply(fact)
    case 'mcp_availability':
      return buildMcpAvailability(fact, keys)
    default:
      return propsRejected('unknown_event')
  }
}
