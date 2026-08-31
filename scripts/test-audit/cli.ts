// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { Glob } from 'bun'

import { auditFragmentation, type AuditDeps } from './fragmentation.ts'

const REPORT_PATH = 'reports/test-audit/fragmentation.json'

/** Production deps: `Bun.Glob` for scanning plus `node:fs` for reads/probes, rooted at cwd. */
const deps = (cwd: string): AuditDeps => ({
  scan: (pattern) => new Glob(pattern).scanSync({ cwd, onlyFiles: true }),
  read: (relPath) => {
    try {
      return fs.readFileSync(path.join(cwd, relPath), 'utf8')
    } catch {
      return null
    }
  },
  exists: (relPath) => fs.existsSync(path.join(cwd, relPath)),
})

const cwd = process.cwd()
const report = auditFragmentation(deps(cwd))

const outPath = path.join(cwd, REPORT_PATH)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)

const pct = (share: number): string => `${(share * 100).toFixed(1)}%`
console.log(
  `fragmentation audit (heuristic v${report.heuristicVersion}): ${report.totals.files} files, ` +
    `${report.totals.caseCount} cases, ${report.totals.matcherCallCount} matcher calls, ` +
    `${pct(report.totals.singleOrZeroAssertShare)} single-or-zero-assert share -> ${REPORT_PATH}`,
)
