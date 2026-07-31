// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { provisionSyntheticDashboard } from './dashboard-provision.js'
import { createTrpcClient } from './trpc.js'

interface DashboardCliOptions {
  readonly baseUrl: string
  readonly cookieJarPath: string
  readonly evidencePath: string
  readonly projectId: string
}

function parseOptions(args: readonly string[]): DashboardCliOptions | null {
  if (args.length % 2 !== 0) return null
  const pairs = Array.from(
    { length: args.length / 2 },
    (_, index) => [args[index * 2] ?? '', args[index * 2 + 1] ?? ''] as const,
  )
  const allowed = new Set(['--base-url', '--cookie-jar', '--evidence', '--project-id'])
  if (pairs.some(([key]) => !allowed.has(key))) return null
  const values: Readonly<Record<string, string>> = Object.fromEntries(pairs)
  const cookieJarPath = values['--cookie-jar']
  const evidencePath = values['--evidence']
  const projectId = values['--project-id']
  if (cookieJarPath === undefined || evidencePath === undefined || projectId === undefined) return null
  if (!path.isAbsolute(cookieJarPath) || !path.isAbsolute(evidencePath)) return null
  return {
    baseUrl: values['--base-url'] ?? 'http://127.0.0.1:4400',
    cookieJarPath,
    evidencePath,
    projectId,
  }
}

async function readSessionCookie(cookieJarPath: string): Promise<string | null> {
  const lines = (await Bun.file(cookieJarPath).text()).split('\n')
  const session = lines
    .map((line) => line.split('\t'))
    .find((columns) => columns.length >= 7 && columns[5] === 'session')
  const value = session?.[6]
  return value === undefined || value.length === 0 ? null : value
}

async function run(options: DashboardCliOptions): Promise<number> {
  const sessionCookie = await readSessionCookie(options.cookieJarPath)
  if (sessionCookie === null) return 1
  const result = createTrpcClient({
    baseUrl: options.baseUrl,
    fetchImpl: fetch,
    sessionCookie,
    timeoutMs: 10_000,
  })
  if (!result.ok) return 1
  const manifest = await provisionSyntheticDashboard({
    baseUrl: options.baseUrl,
    client: result.client,
    projectId: options.projectId,
  })
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  await Bun.write(options.evidencePath, serialized)
  console.log(serialized.trim())
  return 0
}

async function main(): Promise<number> {
  const options = parseOptions(Bun.argv.slice(2))
  if (options === null) {
    console.error(JSON.stringify({ code: 'INVALID_DASHBOARD_ARGUMENTS', status: 'error' }))
    return 1
  }
  try {
    return await run(options)
  } catch (error) {
    const controlled =
      error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message) ? error.message : 'DASHBOARD_PROVISION_FAILED'
    console.error(JSON.stringify({ code: controlled, status: 'error' }))
    return 1
  }
}

process.exitCode = await main()
