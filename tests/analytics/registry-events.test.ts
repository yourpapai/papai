// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ANALYTICS_EVENTS_METADATA_V1 } from '../../src/analytics/registry-events.js'

describe('analytics registry-events metadata', () => {
  test('edit_classified carries the per-window counters and RQ4 coverage', () => {
    expect(ANALYTICS_EVENTS_METADATA_V1.edit_classified).toEqual({
      privacyClass: 'C0',
      sourceFamily: 'edit',
      metricMapping: {
        counters: ['edit_classified_w1', 'edit_classified_w2', 'edit_classified_w3'],
        histograms: [],
      },
      rqCoverage: ['RQ4'],
    })
  })

  test('edit_regen carries the per-phase counters and RQ4 coverage', () => {
    expect(ANALYTICS_EVENTS_METADATA_V1.edit_regen).toEqual({
      privacyClass: 'C0',
      sourceFamily: 'edit',
      metricMapping: {
        counters: [
          'edit_prompt_shown',
          'edit_prompt_adjust',
          'edit_prompt_note',
          'edit_regen_started',
          'edit_regen_completed',
          'edit_regen_failed',
          'edit_history_only',
        ],
        histograms: [],
      },
      rqCoverage: ['RQ4'],
    })
  })
})
