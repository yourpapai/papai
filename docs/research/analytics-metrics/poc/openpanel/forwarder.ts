// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import pLimit from 'p-limit'

import {
  beginDeliveryAttempt,
  completeDeliveryAttempt,
  enqueueDeliveries,
  listPendingEventIds,
  summarizeLedger,
  type LedgerSummary,
} from './ledger.js'
import type { MappedCanonicalEvent, OpenPanelTrackRequest } from './mapping.js'
import type { DeliveryResult } from './transport-types.js'

export type SendOpenPanelEvent = (request: OpenPanelTrackRequest) => Promise<DeliveryResult>

export interface ForwarderOptions {
  readonly concurrency: number
  readonly database: Database
  readonly events: readonly MappedCanonicalEvent[]
  readonly maxAttempts: number
  readonly nowMs: () => number
  readonly send: SendOpenPanelEvent
  readonly sinkId: string
}

export interface ForwarderSummary {
  readonly enqueued: number
  readonly attempted: number
  readonly deliveredThisRun: number
  readonly ambiguousThisRun: number
  readonly retryableThisRun: number
  readonly permanentThisRun: number
  readonly ledger: LedgerSummary
}

type AttemptResult = DeliveryResult | Readonly<{ kind: 'skipped' }>

function assertOptions(options: ForwarderOptions): void {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32) {
    throw new Error('concurrency must be an integer from 1 to 32')
  }
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10) {
    throw new Error('maxAttempts must be an integer from 1 to 10')
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(options.sinkId)) {
    throw new Error('sinkId must be a controlled identifier')
  }
}

async function attemptDelivery(options: ForwarderOptions, event: MappedCanonicalEvent): Promise<AttemptResult> {
  const started = beginDeliveryAttempt(
    options.database,
    event.eventId,
    options.sinkId,
    options.maxAttempts,
    options.nowMs(),
  )
  if (!started) return { kind: 'skipped' }

  let result: DeliveryResult
  try {
    result = await options.send(event.request)
  } catch {
    result = { errorClass: 'network_unknown', kind: 'ambiguous' }
  }
  completeDeliveryAttempt(options.database, event.eventId, options.sinkId, result, options.maxAttempts, options.nowMs())
  return result
}

const countKind = (results: readonly AttemptResult[], kind: AttemptResult['kind']): number =>
  results.filter((result) => result.kind === kind).length

export async function forwardMappedEvents(options: ForwarderOptions): Promise<ForwarderSummary> {
  assertOptions(options)
  const eventsById = new Map(options.events.map((event) => [event.eventId, event]))
  if (eventsById.size !== options.events.length) throw new Error('events must have unique event IDs')
  const enqueued = enqueueDeliveries(options.database, options.sinkId, [...eventsById.keys()])
  const pending = listPendingEventIds(options.database, options.sinkId)
  const limit = pLimit(options.concurrency)
  const results = await Promise.all(
    pending.map((eventId) =>
      limit(() => {
        const event = eventsById.get(eventId)
        return event === undefined
          ? Promise.resolve<AttemptResult>({ kind: 'skipped' })
          : attemptDelivery(options, event)
      }),
    ),
  )
  return {
    ambiguousThisRun: countKind(results, 'ambiguous'),
    attempted: results.length - countKind(results, 'skipped'),
    deliveredThisRun: countKind(results, 'delivered'),
    enqueued,
    ledger: summarizeLedger(options.database, options.sinkId),
    permanentThisRun: countKind(results, 'permanent'),
    retryableThisRun: countKind(results, 'retryable'),
  }
}
