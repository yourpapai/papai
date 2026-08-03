// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { AnalyticsEventV1Schema } from './contracts.js'
import type { AnalyticsEventV1, EventNameV1 } from './contracts.js'
import { EventNameV1Schema } from './controlled-types.js'
import type { KeyVersion, VersionString } from './controlled-types.js'
import { createPseudonym } from './identity/pseudonym.js'
import { buildIdentityKeys } from './identity/scope.js'
import type { IdentityKeys } from './identity/scope.js'
import { buildBoundaryFamilyProps } from './normalizer-props-boundary.js'
import { buildDerivedFamilyProps } from './normalizer-props-derived.js'
import { buildExecutionFamilyProps } from './normalizer-props-execution.js'
import { buildMessageFamilyProps } from './normalizer-props-message.js'
import { factHasOnlyAllowedKeys } from './normalizer-shared.js'
import { createFactKeyDeriver } from './normalizer-shared.js'
import type { NormalizationReason, PropsBuildResult, ValidatedFactRecord } from './normalizer-shared.js'
import { ANALYTICS_EVENT_REGISTRY_V1 } from './registry.js'
import { canonicalEventExpiryMs } from './retention/expiry-guard.js'
import type { AnalyticsSourceContext } from './source-facts.js'

export type NormalizerEnv = Readonly<{
  hmacKey: Buffer
  keyVersion: KeyVersion
  installId: string
  appVersion: VersionString
  policyVersion: number
  ingestedAtMs: number
}>

export type NormalizationResult =
  | Readonly<{ status: 'ok'; event: AnalyticsEventV1 }>
  | Readonly<{ status: 'rejected'; sourceEventType: string; reason: NormalizationReason }>

const SourceContextSchema: z.ZodType<AnalyticsSourceContext> = z.strictObject({
  platform: z.enum(['telegram', 'mattermost', 'discord', 'kontur-talk']),
  platformInstanceId: z.string(),
  chatUserId: z.string().nullable(),
  nativeContextId: z.string(),
  storageContextId: z.string(),
  configContextId: z.string(),
  contextType: z.enum(['dm', 'group']),
  actorRole: z.enum(['admin', 'member', 'guest', 'system']),
  taskInstanceId: z.string().nullable(),
  taskProvider: z.enum(['kaneo', 'youtrack', 'none', 'other']),
  invocationMode: z.enum(['normal', 'command', 'settings', 'proactive', 'scheduler']),
  rawTurnId: z.string().nullable(),
})

const FactEnvelopeSchema = z.looseObject({
  version: z.number(),
  type: z.string(),
  sourceEventId: z.string(),
  occurredAtMs: z.number(),
  source: SourceContextSchema,
})

const rejected = (sourceEventType: string, reason: NormalizationReason): NormalizationResult => ({
  status: 'rejected',
  sourceEventType,
  reason,
})

const buildIdentity = (fact: ValidatedFactRecord, env: NormalizerEnv): IdentityKeys =>
  buildIdentityKeys({
    key: env.hmacKey,
    keyVersion: env.keyVersion,
    platform: fact.source.platform,
    platformInstanceId: fact.source.platformInstanceId,
    storageContextId: fact.source.storageContextId,
    chatUserId: fact.source.chatUserId ?? '',
    actorRole: fact.source.actorRole,
    rawTurnId: fact.source.rawTurnId,
    taskInstanceId: fact.source.taskInstanceId,
    sessionStartMs: null,
    firstEventId: null,
  })

const buildHead = (
  fact: ValidatedFactRecord,
  name: EventNameV1,
  env: NormalizerEnv,
): Pick<AnalyticsEventV1, 'schema' | 'event' | 'app'> => ({
  schema: { name: 'papai.analytics.event', version: 1 },
  event: {
    id: createPseudonym({
      key: env.hmacKey,
      keyVersion: env.keyVersion,
      domain: 'event-source-ref:v1',
      components: [fact.sourceEventId, name],
    }),
    name,
    version: 1,
    occurred_at_ms: fact.occurredAtMs,
    ingested_at_ms: env.ingestedAtMs,
    source: 'live',
    attribution_quality: 'native',
  },
  app: {
    version: env.appVersion,
    deployment_key: createPseudonym({
      key: env.hmacKey,
      keyVersion: env.keyVersion,
      domain: 'deployment:v1',
      components: [env.installId],
    }),
  },
})

const buildIdentitySection = (
  fact: ValidatedFactRecord,
  env: NormalizerEnv,
  identity: IdentityKeys,
): AnalyticsEventV1['identity'] => ({
  key_version: env.keyVersion,
  platform: fact.source.platform,
  platform_instance_key: createPseudonym({
    key: env.hmacKey,
    keyVersion: env.keyVersion,
    domain: 'platform-instance:v1',
    components: [fact.source.platformInstanceId],
  }),
  actor_key: identity.actor_key,
  context_key: identity.context_key,
  thread_key: identity.thread_key,
  task_instance_key: identity.task_instance_key,
})

const buildEvent = (
  fact: ValidatedFactRecord,
  name: EventNameV1,
  props: AnalyticsEventV1['props'],
  env: NormalizerEnv,
): AnalyticsEventV1 => {
  const identity = buildIdentity(fact, env)
  const maxClass = ANALYTICS_EVENT_REGISTRY_V1.privacyClassMap.get(name) ?? 'C0'
  return {
    ...buildHead(fact, name, env),
    identity: buildIdentitySection(fact, env, identity),
    context: {
      context_type: fact.source.contextType,
      actor_role: fact.source.actorRole,
      task_provider: fact.source.taskProvider,
      invocation_mode: fact.source.invocationMode,
    },
    correlation: {
      conversation_key: identity.conversation_key,
      turn_key: identity.turn_key,
      session_key: identity.session_key,
    },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: env.policyVersion,
      eligibility: 'allowed',
    },
    privacy: { max_class: maxClass },
    props,
  }
}

const buildProps = (fact: ValidatedFactRecord, env: NormalizerEnv): PropsBuildResult<AnalyticsEventV1['props']> => {
  const keys = createFactKeyDeriver({ key: env.hmacKey, keyVersion: env.keyVersion })
  switch (fact.type) {
    case 'chat_message_accepted':
    case 'auth_checked':
    case 'turn_started':
    case 'turn_completed':
    case 'reply_sent':
      return buildMessageFamilyProps(fact)
    case 'llm_started':
    case 'llm_completed':
    case 'llm_failed':
    case 'tool_started':
    case 'tool_completed':
    case 'confirmation_requested':
    case 'confirmation_resolved':
    case 'first_visible_feedback':
      return buildExecutionFamilyProps(fact, keys)
    case 'config_link_issued':
    case 'settings_opened':
    case 'task_instance_assigned':
    case 'provider_request_completed':
    case 'rate_limit_blocked':
    case 'unconfigured_reply':
    case 'mcp_availability':
      return buildBoundaryFamilyProps(fact, keys)
    default:
      return buildDerivedFamilyProps(fact, keys)
  }
}

export function normalize(fact: unknown, env: NormalizerEnv): NormalizationResult {
  const envelope = FactEnvelopeSchema.safeParse(fact)
  if (!envelope.success) return rejected('unknown', 'invalid_value')
  const validated: ValidatedFactRecord = envelope.data
  const factType: string = validated.type

  if (validated.version !== 1) return rejected(factType, 'unknown_version')
  if (!Number.isSafeInteger(validated.occurredAtMs) || validated.occurredAtMs < 0) {
    return rejected(factType, 'invalid_value')
  }
  if (canonicalEventExpiryMs(validated.occurredAtMs) <= env.ingestedAtMs) {
    return rejected(factType, 'invalid_value')
  }
  if (validated.sourceEventId.length === 0 || validated.source.platformInstanceId.length === 0) {
    return rejected(factType, 'missing_context')
  }
  const name = parseEventName(validated.type)
  if (name === null) return rejected(factType, 'unknown_event')
  if (!factHasOnlyAllowedKeys(validated, name)) return rejected(factType, 'unknown_property')

  const propsResult = buildProps(validated, env)
  if (!propsResult.ok) return rejected(factType, propsResult.reason)

  const candidate = buildEvent(validated, name, propsResult.props, env)
  const parsed = AnalyticsEventV1Schema.safeParse(candidate)
  if (!parsed.success) return rejected(factType, 'invalid_value')
  return { status: 'ok', event: parsed.data }
}

const parseEventName = (value: string): EventNameV1 | null => {
  const result = EventNameV1Schema.safeParse(value)
  return result.success ? result.data : null
}
