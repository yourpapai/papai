// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { DASHBOARD_NAME, OPENPANEL_REPORT_SPECS } from './dashboard-spec.js'
import type { TrpcClient } from './trpc.js'

interface Identified {
  readonly id: string
  readonly name: string
}

interface Project {
  readonly id: string
  readonly organizationId: string
}

interface DashboardTarget extends Identified {
  readonly organizationId: string
}

interface StoredReport extends Identified {
  readonly chartType: string
}

export interface DashboardManifest {
  readonly schema: 'papai.openpanel.poc.dashboard.v1'
  readonly synthetic_only: true
  readonly api_contract: 'internal_trpc_tag_2'
  readonly image_digests: Readonly<Record<string, string>>
  readonly project_id: string
  readonly dashboard: Readonly<{
    id: string
    name: string
    reports: readonly Readonly<{ chart_type: string; id: string; key: string; name: string }>[]
  }>
  readonly share: Readonly<{ id: string; public: true; url: string }>
  readonly verification: Readonly<{
    dashboard_query: true
    report_count: number
    share_query: true
  }>
  readonly limitations: readonly string[]
}

export interface ProvisionOptions {
  readonly baseUrl: string
  readonly client: TrpcClient
  readonly projectId: string
}

const IMAGE_DIGESTS: Readonly<Record<string, string>> = {
  api: 'sha256:9353647f96dcfcceecd0ba2efd4c05e77ace3ea3f5d56b2cef55c1c3b550be7c',
  caddy: 'sha256:fce4f15aad23222c0ac78a1220adf63bae7b94355d5ea28eee53910624acedfa',
  clickhouse: 'sha256:e019438e1e0539b0d1ce8380b628f1c06c5a0e641f368fc746acf4a8cf48d2f2',
  dashboard: 'sha256:f6934fb35dabba990ca9e73253179494d2e0247fc4b96c8202adbbaa0f06833c',
  postgres: 'sha256:f1341c01408dc7278e9d365ed4f860cd3f87dd16b4464ac326fc0f422083a579',
  redis: 'sha256:6aaf3f5e6bc8a592fbfe2cccf19eb36d27c39d12dab4f4b01556b7449e7b1f44',
  worker: 'sha256:3f996a4f819a84a6ea90272a992fc025c4ad52d70b7612d65d666fafb2f83668',
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function stringField(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field]
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('OPENPANEL_RESPONSE_INVALID')
  }
  return candidate
}

function parseProject(value: unknown): Project {
  if (!isRecord(value)) throw new Error('OPENPANEL_RESPONSE_INVALID')
  return { id: stringField(value, 'id'), organizationId: stringField(value, 'organizationId') }
}

function parseIdentified(value: unknown): Identified {
  if (!isRecord(value)) throw new Error('OPENPANEL_RESPONSE_INVALID')
  return { id: stringField(value, 'id'), name: stringField(value, 'name') }
}

function parseReport(value: unknown): StoredReport {
  if (!isRecord(value)) throw new Error('OPENPANEL_RESPONSE_INVALID')
  return {
    chartType: stringField(value, 'chartType'),
    id: stringField(value, 'id'),
    name: stringField(value, 'name'),
  }
}

function parseList<Value>(value: unknown, parse: (entry: unknown) => Value): readonly Value[] {
  if (!Array.isArray(value)) throw new Error('OPENPANEL_RESPONSE_INVALID')
  return value.map(parse)
}

function findNamed<Value extends Identified>(values: readonly Value[], name: string): Value | undefined {
  return values.find((value) => value.name === name)
}

async function ensureDashboard(options: ProvisionOptions): Promise<DashboardTarget> {
  const project = parseProject(
    await options.client.query('project.getProjectWithClients', { projectId: options.projectId }),
  )
  const dashboards = parseList(
    await options.client.query('dashboard.list', { projectId: options.projectId }),
    parseIdentified,
  )
  const existing = findNamed(dashboards, DASHBOARD_NAME)
  const dashboard =
    existing ??
    parseIdentified(
      await options.client.mutate('dashboard.create', {
        name: DASHBOARD_NAME,
        projectId: options.projectId,
      }),
    )
  return { ...dashboard, organizationId: project.organizationId }
}

async function ensureReports(
  options: ProvisionOptions,
  dashboardId: string,
): Promise<readonly Readonly<{ key: string; report: StoredReport }>[]> {
  const existing = parseList(
    await options.client.query('report.list', { dashboardId, projectId: options.projectId }),
    parseReport,
  )
  const limit = pLimit(2)
  return Promise.all(
    OPENPANEL_REPORT_SPECS.map((spec) =>
      limit(async () => {
        const current = findNamed(existing, spec.report.name)
        const stored = parseReport(
          current === undefined
            ? await options.client.mutate('report.create', {
                dashboardId,
                report: spec.report,
              })
            : await options.client.mutate('report.update', {
                report: spec.report,
                reportId: current.id,
              }),
        )
        return { key: spec.key, report: stored }
      }),
    ),
  )
}

async function publicShare(options: ProvisionOptions, dashboard: DashboardTarget): Promise<string> {
  const created = await options.client.mutate('share.createDashboard', {
    dashboardId: dashboard.id,
    organizationId: dashboard.organizationId,
    password: null,
    projectId: options.projectId,
    public: true,
  })
  if (!isRecord(created)) throw new Error('OPENPANEL_RESPONSE_INVALID')
  return stringField(created, 'id')
}

async function verifyProvisioning(options: ProvisionOptions, dashboardId: string): Promise<readonly StoredReport[]> {
  const [dashboard, reportList, share] = await Promise.all([
    options.client.query('dashboard.byId', { id: dashboardId, projectId: options.projectId }),
    options.client.query('report.list', { dashboardId, projectId: options.projectId }),
    options.client.query('share.dashboard', { dashboardId }),
  ])
  parseIdentified(dashboard)
  if (!isRecord(share) || share['public'] !== true) throw new Error('OPENPANEL_RESPONSE_INVALID')
  const reports = parseList(reportList, parseReport)
  const expectedNames = new Set(OPENPANEL_REPORT_SPECS.map(({ report }) => report.name))
  if (reports.filter(({ name }) => expectedNames.has(name)).length !== expectedNames.size) {
    throw new Error('OPENPANEL_REPORT_VERIFICATION_FAILED')
  }
  return reports
}

export async function provisionSyntheticDashboard(options: ProvisionOptions): Promise<DashboardManifest> {
  const dashboard = await ensureDashboard(options)
  const reports = await ensureReports(options, dashboard.id)
  const shareId = await publicShare(options, dashboard)
  await verifyProvisioning(options, dashboard.id)
  return {
    api_contract: 'internal_trpc_tag_2',
    dashboard: {
      id: dashboard.id,
      name: dashboard.name,
      reports: reports.map(({ key, report }) => ({
        chart_type: report.chartType,
        id: report.id,
        key,
        name: report.name,
      })),
    },
    image_digests: IMAGE_DIGESTS,
    limitations: [
      'internal_trpc_contract_may_drift',
      'pinned_version_coerces_legacy_6m_range_to_30d_so_reports_use_12m',
      'report_chart_values_not_sql_model_equivalence',
      'native_dashboard_export_unavailable',
      'browser_unavailable_no_screenshot',
      'native_session_fidelity_failed_observed',
    ],
    project_id: options.projectId,
    schema: 'papai.openpanel.poc.dashboard.v1',
    share: {
      id: shareId,
      public: true,
      url: new URL(`/share/dashboard/${shareId}`, options.baseUrl).toString(),
    },
    synthetic_only: true,
    verification: { dashboard_query: true, report_count: reports.length, share_query: true },
  }
}
