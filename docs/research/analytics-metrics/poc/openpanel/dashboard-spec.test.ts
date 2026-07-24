// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { DASHBOARD_NAME, OPENPANEL_REPORT_SPECS } from './dashboard-spec.js'

test('defines one synthetic-only dashboard with four required report families', () => {
  expect(DASHBOARD_NAME).toBe('[SYNTHETIC ONLY] papai analytics PoC')
  expect(OPENPANEL_REPORT_SPECS.map(({ key }) => key)).toEqual(['activation', 'retention', 'top_intents', 'errors'])
  expect(OPENPANEL_REPORT_SPECS.every(({ report }) => report.name.startsWith('[SYNTHETIC ONLY]'))).toBe(true)
})

test('pins event series, controlled filters, and fixture-covering ranges', () => {
  const activation = OPENPANEL_REPORT_SPECS[0]?.report
  const retention = OPENPANEL_REPORT_SPECS[1]?.report
  const intents = OPENPANEL_REPORT_SPECS[2]?.report
  const errors = OPENPANEL_REPORT_SPECS[3]?.report

  expect(activation?.chartType).toBe('funnel')
  expect(activation?.series.map(({ name }) => name)).toEqual([
    'chat_message_accepted',
    'config_link_issued',
    'settings_opened',
    'task_instance_assigned',
    'tool_completed',
  ])
  expect(activation?.options).toEqual({ funnelWindow: 336, type: 'funnel' })
  expect(retention?.chartType).toBe('retention')
  expect(retention?.options).toEqual({ criteria: 'on', type: 'retention' })
  expect(intents?.breakdowns).toEqual([{ name: 'primary' }])
  expect(errors?.series).toHaveLength(4)
  expect(OPENPANEL_REPORT_SPECS.every(({ report }) => report.range === '12m')).toBe(true)
})
