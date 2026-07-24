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
} from './normalizer-shared.js'
import type { PropsBuildResult, ValidatedFactRecord } from './normalizer-shared.js'

type Props = AnalyticsEventV1['props']
type Result = PropsBuildResult<Props>

const buildChatMessageAccepted = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.chat_message_accepted.shape
  const inputCount = countBucket(fact['inputCount'])
  const inputLength = lengthBucket(fact['inputLengthChars'])
  const attachmentCount = countBucket(fact['attachmentCount'])
  const isCommand = readBool(fact['isCommand'])
  if (inputCount === null || inputLength === null || attachmentCount === null || isCommand === null) {
    return propsRejected('invalid_value')
  }
  const command = parseEnum(shape.command, fact['command'])
  if (command === null) return propsRejected('unknown_enum')
  return propsOk({
    input_count: inputCount,
    length_bucket: inputLength,
    attachment_count: attachmentCount,
    is_command: isCommand,
    command,
  })
}

const buildAuthChecked = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.auth_checked.shape
  const outcome = parseEnum(shape.outcome, fact['outcome'])
  const reason = parseEnum(shape.reason, fact['reason'])
  if (outcome === null || reason === null) return propsRejected('unknown_enum')
  return propsOk({ outcome, reason })
}

const buildTurnStarted = (fact: ValidatedFactRecord): Result => {
  const incomingMessageCount = countBucket(fact['incomingMessageCount'])
  const attachmentCount = countBucket(fact['attachmentCount'])
  const queueWaitMs = nonNegativeInt(fact['queueWaitMs'])
  if (incomingMessageCount === null || attachmentCount === null || queueWaitMs === null) {
    return propsRejected('invalid_value')
  }
  return propsOk({
    incoming_message_count: incomingMessageCount,
    attachment_count: attachmentCount,
    queue_wait_ms: queueWaitMs,
  })
}

const buildTurnCompleted = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.turn_completed.shape
  const outcome = parseEnum(shape.outcome, fact['outcome'])
  const finishReason = parseEnum(shape.finish_reason, fact['finishReason'])
  if (outcome === null || finishReason === null) return propsRejected('unknown_enum')
  const durationMs = nonNegativeInt(fact['durationMs'])
  const stepCount = nonNegativeInt(fact['stepCount'])
  const toolCallCount = nonNegativeInt(fact['toolCallCount'])
  const replyCount = countBucket(fact['replyCount'])
  const clarification = readBool(fact['clarification'])
  const liveStatusUsed = readBool(fact['liveStatusUsed'])
  if (
    durationMs === null ||
    stepCount === null ||
    toolCallCount === null ||
    replyCount === null ||
    clarification === null ||
    liveStatusUsed === null
  ) {
    return propsRejected('invalid_value')
  }
  return propsOk({
    outcome,
    duration_ms: durationMs,
    step_count: stepCount,
    tool_call_count: toolCallCount,
    reply_count: replyCount,
    finish_reason: finishReason,
    clarification,
    live_status_used: liveStatusUsed,
  })
}

const buildReplySent = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.reply_sent.shape
  const delivery = parseEnum(shape.delivery, fact['delivery'])
  if (delivery === null) return propsRejected('unknown_enum')
  const latencyMs = nonNegativeInt(fact['latencyMs'])
  const partCount = countBucket(fact['partCount'])
  const totalLength = lengthBucket(fact['totalLengthChars'])
  if (latencyMs === null || partCount === null || totalLength === null) {
    return propsRejected('invalid_value')
  }
  return propsOk({ latency_ms: latencyMs, part_count: partCount, length_bucket: totalLength, delivery })
}

export const buildMessageFamilyProps = (fact: ValidatedFactRecord): Result => {
  switch (fact.type) {
    case 'chat_message_accepted':
      return buildChatMessageAccepted(fact)
    case 'auth_checked':
      return buildAuthChecked(fact)
    case 'turn_started':
      return buildTurnStarted(fact)
    case 'turn_completed':
      return buildTurnCompleted(fact)
    case 'reply_sent':
      return buildReplySent(fact)
    default:
      return propsRejected('unknown_event')
  }
}
