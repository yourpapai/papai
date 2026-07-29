#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Read-only Stage B evidence report. Usage:
 *   bun run scripts/analytics-stage-b-report.ts [--day YYYY-MM-DD] [--db PATH] [--log PATH]
 *   bun run scripts/analytics-stage-b-report.ts --assess --log PATH [--db PATH]
 * Exit 0 = report produced (ineligible days are data); exit 1 = operational failure.
 */

import { Database } from 'bun:sqlite'
import { appendFileSync, readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import { ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV, ANALYTICS_HMAC_KEYRING_ENV } from '../src/analytics/config.js'
import { assessGovernanceReadiness, getPolicy } from '../src/analytics/governance/policy-store.js'
import { parseAnalyticsKeyring, parseGovernanceKeyring } from '../src/analytics/identity/keyring.js'
import { assessRecordedWindow, parseStageBLog } from '../src/analytics/jobs/stage-b-assess.js'
import {
  collectStageBDay,
  formatDaySummary,
  formatWindowLogRow,
  parseStageBArgs,
} from '../src/analytics/jobs/stage-b-report.js'
import * as schema from '../src/db/schema.js'

const DAY_MS = 86_400_000

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>

const main = (): number => {
  const args = parseStageBArgs(process.argv.slice(2))
  const dbPath = args.dbPath ?? process.env['DB_PATH']
  if (dbPath === undefined) {
    console.error('error=db_path_required set --db or DB_PATH')
    return 1
  }
  let db: DrizzleDb
  try {
    const sqlite = new Database(dbPath, { readonly: true })
    sqlite.run('PRAGMA foreign_keys=ON')
    db = drizzle(sqlite, { schema })
  } catch (error) {
    console.error(`error=db_unreadable detail=${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  const deps = { getDrizzleDb: (): DrizzleDb => db }
  const nowMs = Date.now()
  try {
    if (args.assess) {
      if (args.logPath === null) {
        console.error('error=log_required_for_assess pass --log PATH')
        return 1
      }
      const records = parseStageBLog(readFileSync(args.logPath, 'utf8'))
      const readiness = assessGovernanceReadiness({
        policy: getPolicy(deps),
        analyticsKeyring: parseAnalyticsKeyring(process.env[ANALYTICS_HMAC_KEYRING_ENV]),
        governanceKeyring: parseGovernanceKeyring(process.env[ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV]),
      })
      const verdict = assessRecordedWindow(records, readiness)
      const stageC = verdict.stageCEntry.allowed ? 'allowed' : `refused(${verdict.stageCEntry.refusals.join(',')})`
      console.log(
        `consecutive_complete_weeks=${verdict.consecutiveCompleteWeeks} stage_b_exit=${verdict.stageBExit ? 'allowed' : 'refused'} stage_c_entry=${stageC}`,
      )
      return 0
    }
    const day = args.day ?? new Date(nowMs - DAY_MS).toISOString().slice(0, 10)
    const report = collectStageBDay({ day, nowMs }, deps)
    console.log(formatDaySummary(report))
    console.log('window-log-row:')
    console.log(formatWindowLogRow(report))
    if (args.logPath !== null) appendFileSync(args.logPath, `${JSON.stringify(report)}\n`)
    return 0
  } catch (error) {
    console.error(`error=report_failed detail=${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

process.exit(main())
