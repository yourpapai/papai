// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsEventV1 } from './contracts.js'
import { propsByEventName } from './event-props.js'
import {
  countBucket,
  lengthBucket,
  nonNegativeInt,
  parseEnum,
  propsOk,
  propsRejected,
  readBool,
  readNonEmptyString,
  readStringArray,
} from './normalizer-shared.js'
import type { FactKeyDeriver, PropsBuildResult, ValidatedFactRecord } from './normalizer-shared.js'

type Props = AnalyticsEventV1['props']
type Result = PropsBuildResult<Props>

const buildIntentClassified = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.intent_classified.shape
  if (fact['taxonomy'] !== 'intent.v1') return propsRejected('unknown_version')
  const primary = parseEnum(shape.primary, fact['primary'])
  const goalsInput = readStringArray(fact['goals'])
  const confidence = parseEnum(shape.confidence, fact['confidence'])
  const strategy = parseEnum(shape.strategy, fact['strategy'])
  if (primary === null || confidence === null || strategy === null) return propsRejected('unknown_enum')
  if (goalsInput === null) return propsRejected('invalid_value')
  const goals = parseEnum(shape.goals, goalsInput)
  if (goals === null) return propsRejected('unknown_enum')
  const abstained = readBool(fact['abstained'])
  if (abstained === null) return propsRejected('invalid_value')
  return propsOk({ taxonomy: 'intent.v1', primary, goals, confidence, strategy, abstained })
}

const buildFeatureOpportunity = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.feature_opportunity.shape
  const feature = parseEnum(shape.feature, fact['feature'])
  const reason = parseEnum(shape.reason, fact['reason'])
  if (feature === null || reason === null) return propsRejected('unknown_enum')
  if (fact['sampling'] !== 'first_eligible_actor_day') return propsRejected('unknown_version')
  const available = readBool(fact['available'])
  if (available === null) return propsRejected('invalid_value')
  return propsOk({ feature, available, reason, sampling: 'first_eligible_actor_day' })
}

const buildFeatureUsed = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  const shape = propsByEventName.feature_used.shape
  const feature = parseEnum(shape.feature, fact['feature'])
  const operation = parseEnum(shape.operation, fact['operation'])
  const outcome = parseEnum(shape.outcome, fact['outcome'])
  if (feature === null || operation === null || outcome === null) return propsRejected('unknown_enum')
  const projectRaw = readNonEmptyString(fact['codingProjectRawId'])
  const sessionRaw = readNonEmptyString(fact['codingSessionRawId'])
  if (fact['codingProjectRawId'] !== null && projectRaw === null) return propsRejected('invalid_value')
  if (fact['codingSessionRawId'] !== null && sessionRaw === null) return propsRejected('invalid_value')
  const platformInstanceId = fact.source.platformInstanceId
  return propsOk({
    feature,
    operation,
    outcome,
    ...(projectRaw === null ? {} : { coding_project_key: keys.codingProjectKey(platformInstanceId, projectRaw) }),
    ...(sessionRaw === null ? {} : { coding_session_key: keys.codingSessionKey(platformInstanceId, sessionRaw) }),
  })
}

const buildTurnSteered = (fact: ValidatedFactRecord): Result => {
  const ordinal = nonNegativeInt(fact['ordinal'])
  const steerLength = lengthBucket(fact['steerLengthChars'])
  const ackSent = readBool(fact['ackSent'])
  if (ordinal === null || steerLength === null || ackSent === null) return propsRejected('invalid_value')
  return propsOk({ ordinal, length_bucket: steerLength, ack_sent: ackSent })
}

const buildTurnStopRequested = (fact: ValidatedFactRecord): Result => {
  const stage = parseEnum(propsByEventName.turn_stop_requested.shape.stage, fact['stage'])
  if (stage === null) return propsRejected('unknown_enum')
  return propsOk({ stage })
}

const buildClarificationRequested = (fact: ValidatedFactRecord): Result => {
  const reason = parseEnum(propsByEventName.clarification_requested.shape.reason, fact['reason'])
  if (reason === null) return propsRejected('unknown_enum')
  return propsOk({ reason })
}

const buildRephraseDetected = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.rephrase_detected.shape
  const detector = parseEnum(shape.detector, fact['detector'])
  const similarity = parseEnum(shape.similarity, fact['similarity'])
  const priorOutcome = parseEnum(shape.prior_outcome, fact['priorOutcome'])
  const gap = parseEnum(shape.gap, fact['gap'])
  if (detector === null || similarity === null || priorOutcome === null || gap === null) {
    return propsRejected('unknown_enum')
  }
  return propsOk({ detector, similarity, prior_outcome: priorOutcome, gap })
}

const buildClarificationAbandoned = (fact: ValidatedFactRecord): Result => {
  if (fact['observationHours'] !== 24) return propsRejected('invalid_value')
  return propsOk({ observation_hours: 24 })
}

const buildDisclosureFallback = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.disclosure_fallback.shape
  const reason = parseEnum(shape.reason, fact['reason'])
  if (reason === null) return propsRejected('unknown_enum')
  const stepCount = nonNegativeInt(fact['stepCount'])
  if (stepCount === null || stepCount === 0) return propsRejected('invalid_value')
  const stepBucket = stepCount <= 2 ? '1_2' : stepCount <= 5 ? '3_5' : '6_plus'
  return propsOk({ reason, step_bucket: stepBucket })
}

const buildLiveStatusOpportunity = (fact: ValidatedFactRecord): Result => {
  const reason = parseEnum(propsByEventName.live_status_opportunity.shape.reason, fact['reason'])
  if (reason === null) return propsRejected('unknown_enum')
  const eligible = readBool(fact['eligible'])
  if (eligible === null) return propsRejected('invalid_value')
  return propsOk({ eligible, reason })
}

const buildLiveStatusLifecycle = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.live_status_lifecycle.shape
  const stage = parseEnum(shape.stage, fact['stage'])
  const outcome = parseEnum(shape.outcome, fact['outcome'])
  if (stage === null || outcome === null) return propsRejected('unknown_enum')
  const latency = nonNegativeInt(fact['latencyFromTurnStartMs'])
  const ordinal = nonNegativeInt(fact['ordinal'])
  if (latency === null || ordinal === null) return propsRejected('invalid_value')
  return propsOk({ stage, outcome, latency_from_turn_start_ms: latency, ordinal })
}

const buildGuestTurnAggregate = (fact: ValidatedFactRecord): Result => {
  const utcDay = parseEnum(propsByEventName.guest_turn_aggregate.shape.utc_day, fact['utcDay'])
  if (utcDay === null) return propsRejected('invalid_value')
  const turns = nonNegativeInt(fact['turns'])
  const successfulTurns = nonNegativeInt(fact['successfulTurns'])
  const failedTurns = nonNegativeInt(fact['failedTurns'])
  const contexts = countBucket(fact['contextCount'])
  if (turns === null || successfulTurns === null || failedTurns === null || contexts === null) {
    return propsRejected('invalid_value')
  }
  return propsOk({ utc_day: utcDay, turns, successful_turns: successfulTurns, failed_turns: failedTurns, contexts })
}

export const buildDerivedFamilyProps = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  switch (fact.type) {
    case 'intent_classified':
      return buildIntentClassified(fact)
    case 'feature_opportunity':
      return buildFeatureOpportunity(fact)
    case 'feature_used':
      return buildFeatureUsed(fact, keys)
    case 'turn_steered':
      return buildTurnSteered(fact)
    case 'turn_stop_requested':
      return buildTurnStopRequested(fact)
    case 'clarification_requested':
      return buildClarificationRequested(fact)
    case 'rephrase_detected':
      return buildRephraseDetected(fact)
    case 'clarification_abandoned':
      return buildClarificationAbandoned(fact)
    case 'disclosure_fallback':
      return buildDisclosureFallback(fact)
    case 'live_status_opportunity':
      return buildLiveStatusOpportunity(fact)
    case 'live_status_lifecycle':
      return buildLiveStatusLifecycle(fact)
    case 'guest_turn_aggregate':
      return buildGuestTurnAggregate(fact)
    default:
      return propsRejected('unknown_event')
  }
}
