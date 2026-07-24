// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const DASHBOARD_NAME = '[SYNTHETIC ONLY] papai analytics PoC'

type FilterValue = string | number | boolean | null

interface EventFilter {
  readonly name: string
  readonly operator: 'is' | 'isNotNull'
  readonly value: readonly FilterValue[]
}

interface EventSeries {
  readonly type: 'event'
  readonly name: string
  readonly segment: 'event' | 'user'
  readonly filters: readonly EventFilter[]
}

interface Breakdown {
  readonly name: string
}

type ReportOptions =
  | Readonly<{ type: 'funnel'; funnelWindow: number }>
  | Readonly<{ type: 'retention'; criteria: 'on' | 'on_or_after' }>

export interface OpenPanelReport {
  readonly name: string
  readonly chartType: 'bar' | 'funnel' | 'retention'
  readonly interval: 'day'
  readonly series: readonly EventSeries[]
  readonly breakdowns: readonly Breakdown[]
  readonly range: '12m'
  readonly previous: false
  readonly metric: 'sum'
  readonly lineType: 'monotone'
  readonly options?: ReportOptions
}

export interface OpenPanelReportSpec {
  readonly key: 'activation' | 'retention' | 'top_intents' | 'errors'
  readonly report: OpenPanelReport
}

const event = (
  name: string,
  segment: EventSeries['segment'] = 'event',
  filters: readonly EventFilter[] = [],
): EventSeries => ({ filters, name, segment, type: 'event' })

const baseReport = (
  name: string,
  chartType: OpenPanelReport['chartType'],
  series: readonly EventSeries[],
  breakdowns: readonly Breakdown[] = [],
): Omit<OpenPanelReport, 'options'> => ({
  breakdowns,
  chartType,
  interval: 'day',
  lineType: 'monotone',
  metric: 'sum',
  name,
  previous: false,
  range: '12m',
  series,
})

const activation: OpenPanelReportSpec = {
  key: 'activation',
  report: {
    ...baseReport('[SYNTHETIC ONLY] Activation funnel — native approximation', 'funnel', [
      event('chat_message_accepted', 'user'),
      event('config_link_issued', 'user'),
      event('settings_opened', 'user'),
      event('task_instance_assigned', 'user'),
      event('tool_completed', 'user', [
        { name: 'domain', operator: 'is', value: ['task'] },
        { name: 'risk', operator: 'is', value: ['write', 'destructive'] },
        { name: 'execution_outcome', operator: 'is', value: ['semantic_success'] },
      ]),
    ]),
    options: { funnelWindow: 336, type: 'funnel' },
  },
}

const retention: OpenPanelReportSpec = {
  key: 'retention',
  report: {
    ...baseReport('[SYNTHETIC ONLY] Event retention — native approximation', 'retention', [
      event('chat_message_accepted', 'user'),
      event('turn_completed', 'user'),
    ]),
    options: { criteria: 'on', type: 'retention' },
  },
}

const topIntents: OpenPanelReportSpec = {
  key: 'top_intents',
  report: baseReport(
    '[SYNTHETIC ONLY] Top classified intents',
    'bar',
    [event('intent_classified')],
    [{ name: 'primary' }],
  ),
}

const errors: OpenPanelReportSpec = {
  key: 'errors',
  report: baseReport('[SYNTHETIC ONLY] Controlled error signals', 'bar', [
    event('llm_failed'),
    event('tool_completed', 'event', [
      { name: 'execution_outcome', operator: 'is', value: ['structured_failure', 'thrown_failure'] },
    ]),
    event('provider_request_completed', 'event', [{ name: 'outcome', operator: 'is', value: ['failure'] }]),
    event('mcp_availability', 'event', [{ name: 'outcome', operator: 'is', value: ['connection_failed'] }]),
  ]),
}

export const OPENPANEL_REPORT_SPECS: readonly OpenPanelReportSpec[] = [activation, retention, topIntents, errors]
