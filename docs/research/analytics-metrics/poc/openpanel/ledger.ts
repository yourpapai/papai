// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { DeliveryErrorClass, DeliveryResult } from './transport-types.js'

export type DeliveryState = 'pending' | 'delivered' | 'ambiguous' | 'dead'

export interface DeliveryRow {
  readonly event_id: string
  readonly sink_id: string
  readonly state: DeliveryState
  readonly attempts: number
  readonly last_attempt_at_ms: number | null
  readonly delivered_at_ms: number | null
  readonly last_error_class: DeliveryErrorClass | null
}

export interface LedgerSummary {
  readonly total: number
  readonly pending: number
  readonly delivered: number
  readonly ambiguous: number
  readonly dead: number
  readonly attempts: number
}

interface EventIdRow {
  readonly event_id: string
}

interface AttemptRow {
  readonly attempts: number
}

interface SummaryRow {
  readonly total: number
  readonly pending: number
  readonly delivered: number
  readonly ambiguous: number
  readonly dead: number
  readonly attempts: number
}

type Bindings = Readonly<Record<string, string | number | null>>

const LEDGER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS openpanel_delivery_ledger (
    event_id TEXT NOT NULL,
    sink_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'ambiguous', 'dead')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_attempt_at_ms INTEGER,
    delivered_at_ms INTEGER,
    last_error_class TEXT
      CHECK (
        last_error_class IS NULL OR
        last_error_class IN ('ambiguous_ack', 'http_permanent', 'http_retryable', 'network_unknown')
      ),
    PRIMARY KEY (event_id, sink_id)
  );
  CREATE INDEX IF NOT EXISTS openpanel_delivery_ready_idx
    ON openpanel_delivery_ledger (sink_id, state, event_id);
`

export function initializeDeliveryLedger(database: Database): void {
  database.run(LEDGER_SCHEMA)
}

export function enqueueDeliveries(database: Database, sinkId: string, eventIds: readonly string[]): number {
  using statement = database.query<never, Bindings>(
    `INSERT OR IGNORE INTO openpanel_delivery_ledger (event_id, sink_id, state)
     VALUES ($event_id, $sink_id, 'pending')`,
  )
  return database.transaction((ids: readonly string[]) =>
    ids.reduce((inserted, eventId) => inserted + statement.run({ event_id: eventId, sink_id: sinkId }).changes, 0),
  )(eventIds)
}

export function listPendingEventIds(database: Database, sinkId: string): readonly string[] {
  return database
    .query<EventIdRow, Bindings>(
      `SELECT event_id
       FROM openpanel_delivery_ledger
       WHERE sink_id = $sink_id AND state = 'pending'
       ORDER BY event_id`,
    )
    .all({ sink_id: sinkId })
    .map(({ event_id }) => event_id)
}

export function beginDeliveryAttempt(
  database: Database,
  eventId: string,
  sinkId: string,
  maxAttempts: number,
  nowMs: number,
): boolean {
  const result = database
    .query<never, Bindings>(
      `UPDATE openpanel_delivery_ledger
     SET attempts = attempts + 1, last_attempt_at_ms = $now_ms
     WHERE event_id = $event_id
       AND sink_id = $sink_id
       AND state = 'pending'
       AND attempts < $max_attempts`,
    )
    .run({ event_id: eventId, max_attempts: maxAttempts, now_ms: nowMs, sink_id: sinkId })
  return result.changes === 1
}

function terminalState(result: DeliveryResult): Exclude<DeliveryState, 'pending'> | null {
  if (result.kind === 'delivered') return 'delivered'
  if (result.kind === 'ambiguous') return 'ambiguous'
  if (result.kind === 'permanent') return 'dead'
  return null
}

function completeTerminal(
  database: Database,
  eventId: string,
  sinkId: string,
  state: Exclude<DeliveryState, 'pending'>,
  errorClass: DeliveryErrorClass | null,
  nowMs: number,
): void {
  database
    .query<never, Bindings>(
      `UPDATE openpanel_delivery_ledger
     SET state = $state,
         delivered_at_ms = $delivered_at_ms,
         last_error_class = $last_error_class
     WHERE event_id = $event_id AND sink_id = $sink_id AND state = 'pending'`,
    )
    .run({
      delivered_at_ms: state === 'delivered' ? nowMs : null,
      event_id: eventId,
      last_error_class: errorClass,
      sink_id: sinkId,
      state,
    })
}

function completeRetryable(database: Database, eventId: string, sinkId: string, maxAttempts: number): void {
  const row = database
    .query<AttemptRow, Bindings>(
      `SELECT attempts FROM openpanel_delivery_ledger
       WHERE event_id = $event_id AND sink_id = $sink_id`,
    )
    .get({ event_id: eventId, sink_id: sinkId })
  const state: DeliveryState = (row?.attempts ?? maxAttempts) >= maxAttempts ? 'dead' : 'pending'
  database
    .query<never, Bindings>(
      `UPDATE openpanel_delivery_ledger
     SET state = $state, last_error_class = 'http_retryable'
     WHERE event_id = $event_id AND sink_id = $sink_id AND state = 'pending'`,
    )
    .run({ event_id: eventId, sink_id: sinkId, state })
}

export function completeDeliveryAttempt(
  database: Database,
  eventId: string,
  sinkId: string,
  result: DeliveryResult,
  maxAttempts: number,
  nowMs: number,
): void {
  const state = terminalState(result)
  if (state === null) {
    completeRetryable(database, eventId, sinkId, maxAttempts)
    return
  }
  const errorClass = result.kind === 'delivered' ? null : result.errorClass
  completeTerminal(database, eventId, sinkId, state, errorClass, nowMs)
}

export function getDelivery(database: Database, eventId: string, sinkId: string): DeliveryRow | null {
  return (
    database
      .query<DeliveryRow, Bindings>(
        `SELECT event_id, sink_id, state, attempts, last_attempt_at_ms, delivered_at_ms, last_error_class
         FROM openpanel_delivery_ledger
         WHERE event_id = $event_id AND sink_id = $sink_id`,
      )
      .get({ event_id: eventId, sink_id: sinkId }) ?? null
  )
}

export function summarizeLedger(database: Database, sinkId: string): LedgerSummary {
  const row = database
    .query<SummaryRow, Bindings>(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(state = 'pending'), 0) AS pending,
         COALESCE(SUM(state = 'delivered'), 0) AS delivered,
         COALESCE(SUM(state = 'ambiguous'), 0) AS ambiguous,
         COALESCE(SUM(state = 'dead'), 0) AS dead,
         COALESCE(SUM(attempts), 0) AS attempts
       FROM openpanel_delivery_ledger
       WHERE sink_id = $sink_id`,
    )
    .get({ sink_id: sinkId })
  return row ?? { ambiguous: 0, attempts: 0, dead: 0, delivered: 0, pending: 0, total: 0 }
}
