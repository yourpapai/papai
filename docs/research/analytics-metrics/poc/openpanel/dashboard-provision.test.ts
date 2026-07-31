// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { provisionSyntheticDashboard } from './dashboard-provision.js'
import type { TrpcClient } from './trpc.js'

interface Call {
  readonly procedure: string
  readonly input: unknown
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function reportFromInput(input: unknown): Readonly<{ chartType: string; name: string }> {
  if (!isRecord(input)) throw new Error('Missing report input')
  const report = input['report']
  if (!isRecord(report) || typeof report['chartType'] !== 'string' || typeof report['name'] !== 'string') {
    throw new Error('Invalid report input')
  }
  return { chartType: report['chartType'], name: report['name'] }
}

function targetsSyntheticDashboard(call: Call): boolean {
  return isRecord(call.input) && call.input['dashboardId'] === 'synthetic-dashboard'
}

const isReportOrShareMutation = ({ procedure }: Call): boolean =>
  procedure === 'report.create' || procedure === 'share.createDashboard'

function fakeClient(calls: Call[]): TrpcClient {
  const reports: Readonly<Record<string, unknown>>[] = []
  const query = (procedure: string, input: unknown): Promise<unknown> => {
    calls.push({ input, procedure })
    if (procedure === 'project.getProjectWithClients') {
      return Promise.resolve({ id: 'papai-analytics-poc', organizationId: 'synthetic-org' })
    }
    if (procedure === 'dashboard.list') return Promise.resolve([])
    if (procedure === 'report.list') return Promise.resolve(reports)
    if (procedure === 'dashboard.byId') {
      return Promise.resolve({ id: 'synthetic-dashboard', name: '[SYNTHETIC ONLY] papai analytics PoC' })
    }
    if (procedure === 'share.dashboard') {
      return Promise.resolve({ dashboardId: 'synthetic-dashboard', id: 'synthetic-share', public: true })
    }
    return Promise.reject(new Error(`Unexpected query ${procedure}`))
  }
  const mutate = (procedure: string, input: unknown): Promise<unknown> => {
    calls.push({ input, procedure })
    if (procedure === 'dashboard.create') {
      return Promise.resolve({ id: 'synthetic-dashboard', name: '[SYNTHETIC ONLY] papai analytics PoC' })
    }
    if (procedure === 'report.create') {
      const report = reportFromInput(input)
      const created = {
        chartType: report.chartType,
        id: `report-${reports.length + 1}`,
        name: report.name,
      }
      reports.push(created)
      return Promise.resolve(created)
    }
    if (procedure === 'report.update') {
      const report = reportFromInput(input)
      const existing = reports.find(({ name }) => name === report.name)
      if (existing === undefined) return Promise.reject(new Error('Missing report'))
      return Promise.resolve(existing)
    }
    if (procedure === 'share.createDashboard') {
      return Promise.resolve({ id: 'synthetic-share', public: true })
    }
    return Promise.reject(new Error(`Unexpected mutation ${procedure}`))
  }
  return { mutate, query }
}

test('provisions and verifies four synthetic reports plus a public share manifest', async () => {
  const calls: Call[] = []

  const manifest = await provisionSyntheticDashboard({
    baseUrl: 'http://127.0.0.1:4400',
    client: fakeClient(calls),
    projectId: 'papai-analytics-poc',
  })

  expect(manifest.schema).toBe('papai.openpanel.poc.dashboard.v1')
  expect(manifest.synthetic_only).toBe(true)
  expect(manifest.dashboard.name).toBe('[SYNTHETIC ONLY] papai analytics PoC')
  expect(manifest.dashboard.reports.map(({ key }) => key)).toEqual(['activation', 'retention', 'top_intents', 'errors'])
  expect(manifest.share.url).toBe('http://127.0.0.1:4400/share/dashboard/synthetic-share')
  expect(manifest.verification).toEqual({
    dashboard_query: true,
    report_count: 4,
    share_query: true,
  })
  expect(calls.filter(({ procedure }) => procedure === 'report.create')).toHaveLength(4)
  expect(calls.filter(isReportOrShareMutation).every(targetsSyntheticDashboard)).toBe(true)
  expect(JSON.stringify(manifest)).not.toContain('synthetic-org')
})

test('updates existing reports so pinned range corrections are reproducible', async () => {
  const calls: Call[] = []
  const client = fakeClient(calls)
  const options = {
    baseUrl: 'http://127.0.0.1:4400',
    client,
    projectId: 'papai-analytics-poc',
  } as const
  await provisionSyntheticDashboard(options)
  calls.splice(0)

  await provisionSyntheticDashboard(options)

  expect(calls.filter(({ procedure }) => procedure === 'report.create')).toHaveLength(0)
  expect(calls.filter(({ procedure }) => procedure === 'report.update')).toHaveLength(4)
})
