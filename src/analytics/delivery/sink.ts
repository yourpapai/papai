// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const DELIVERY_PAYLOAD_SCHEMA_VERSION = 1

export type SinkEgressMode = 'aggregate' | 'pseudonymous'

export type SinkCapabilities = Readonly<{
  callerControlledIdempotency: boolean
  deterministicReconciliation: boolean
  deleteActor: boolean
}>

export type DeliveryErrorClass = 'network' | 'timeout' | 'http_4xx' | 'http_5xx' | 'auth' | 'policy' | 'unknown'

export const DELIVERY_ERROR_CLASSES: readonly DeliveryErrorClass[] = [
  'network',
  'timeout',
  'http_4xx',
  'http_5xx',
  'auth',
  'policy',
  'unknown',
]

export type StrictDeliveryPayloadV1 = Readonly<{
  schemaVersion: 1
  eventName: string
  occurredAtMs: number
  propsJson: string
}>

export type DeliveryResult =
  | Readonly<{ eventId: string; outcome: 'delivered'; remoteReceiptHash: string }>
  | Readonly<{ eventId: string; outcome: 'retryable'; errorClass: DeliveryErrorClass; retryAtMs: number }>
  | Readonly<{ eventId: string; outcome: 'ambiguous'; errorClass: DeliveryErrorClass }>
  | Readonly<{ eventId: string; outcome: 'dead'; errorClass: DeliveryErrorClass }>

export type DeletionResult = Readonly<{
  status: 'confirmed' | 'failed'
  remoteReceiptHash: string | null
}>

export interface AnalyticsSink {
  readonly sinkVersionId: string
  readonly mode: SinkEgressMode
  readonly payloadSchemaVersion: 1
  readonly capabilities: SinkCapabilities
  send(batch: readonly StrictDeliveryPayloadV1[]): Promise<readonly DeliveryResult[]>
  deleteActor?(actorKey: string): Promise<DeletionResult>
}

export type SinkProcessorReview = Readonly<{
  subprocessorReviewed: boolean
  residencyReviewed: boolean
  deletionPathReviewed: boolean
  incidentReviewed: boolean
  transferReviewed: boolean
  noSecondaryUse: boolean
}>

export type SinkGateDenial =
  | 'sink_disabled'
  | 'payload_schema_unpinned'
  | 'https_policy_not_approved'
  | 'processor_review_incomplete'
  | 'missing_caller_controlled_idempotency'
  | 'missing_deterministic_reconciliation'
  | 'missing_delete_actor'

export type SinkGateResult = Readonly<{ approved: true }> | Readonly<{ approved: false; reason: SinkGateDenial }>

export type AssessSinkInput = Readonly<{
  mode: SinkEgressMode
  state: 'pending_verification' | 'enabled' | 'disabled'
  payloadSchemaVersion: number
  capabilities: SinkCapabilities
  processorReview: SinkProcessorReview
  httpsPolicyApproved: boolean
}>

const processorReviewComplete = (review: SinkProcessorReview): boolean =>
  review.subprocessorReviewed &&
  review.residencyReviewed &&
  review.deletionPathReviewed &&
  review.incidentReviewed &&
  review.transferReviewed &&
  review.noSecondaryUse

export const assessSink = (input: AssessSinkInput): SinkGateResult => {
  if (input.state === 'disabled') return { approved: false, reason: 'sink_disabled' }
  if (input.payloadSchemaVersion !== DELIVERY_PAYLOAD_SCHEMA_VERSION) {
    return { approved: false, reason: 'payload_schema_unpinned' }
  }
  if (!input.httpsPolicyApproved) return { approved: false, reason: 'https_policy_not_approved' }
  if (!processorReviewComplete(input.processorReview)) {
    return { approved: false, reason: 'processor_review_incomplete' }
  }
  if (input.mode === 'aggregate') return { approved: true }
  if (!input.capabilities.callerControlledIdempotency) {
    return { approved: false, reason: 'missing_caller_controlled_idempotency' }
  }
  if (!input.capabilities.deterministicReconciliation) {
    return { approved: false, reason: 'missing_deterministic_reconciliation' }
  }
  if (!input.capabilities.deleteActor) return { approved: false, reason: 'missing_delete_actor' }
  return { approved: true }
}
