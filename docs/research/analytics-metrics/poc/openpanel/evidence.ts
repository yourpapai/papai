// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ForwarderSummary } from './forwarder.js'

export interface RunEvidenceInput {
  readonly baseUrl: string
  readonly fixtureSha256: string
  readonly forwarder: ForwarderSummary
  readonly profileEventCount: number
  readonly selectedEventCount: number
  readonly simulateAmbiguousSuccesses: number
  readonly sinkId: string
  readonly sourceEventCount: number
}

export interface RunEvidence {
  readonly schema: 'papai.openpanel.poc.run.v1'
  readonly synthetic_only: true
  readonly source: Readonly<{
    fixture_sha256: string
    source_events: number
    selected_events: number
    profile_events: number
    anonymous_events: number
  }>
  readonly transport: Readonly<{
    base_url: string
    endpoint: '/api/track'
    acknowledged_statuses: readonly [200, 202]
    simulated_ambiguous_successes: number
  }>
  readonly delivery: Readonly<{
    sink_id: string
    this_run: Omit<ForwarderSummary, 'ledger'>
    ledger: ForwarderSummary['ledger']
  }>
  readonly limitations: readonly string[]
}

export function buildRunEvidence(input: RunEvidenceInput): RunEvidence {
  const { ledger, ...thisRun } = input.forwarder
  return {
    delivery: { ledger, sink_id: input.sinkId, this_run: thisRun },
    limitations: [
      'diagnostic_event_id_is_not_destination_idempotency',
      'ambiguous_rows_are_not_automatically_retried',
      'queue_ack_is_not_durable_query_visibility',
      'native_session_fidelity_failed_observed',
      'complete_per_profile_deletion_not_proven',
      'pseudonymous_production_gate_remains_failed',
      'dashboard_api_is_internal_and_version_specific',
      'browser_and_native_dashboard_export_unavailable',
    ],
    schema: 'papai.openpanel.poc.run.v1',
    source: {
      anonymous_events: input.selectedEventCount - input.profileEventCount,
      fixture_sha256: input.fixtureSha256,
      profile_events: input.profileEventCount,
      selected_events: input.selectedEventCount,
      source_events: input.sourceEventCount,
    },
    synthetic_only: true,
    transport: {
      acknowledged_statuses: [200, 202],
      base_url: input.baseUrl,
      endpoint: '/api/track',
      simulated_ambiguous_successes: input.simulateAmbiguousSuccesses,
    },
  }
}
