// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Repo-relative locations for the durable check-run artifacts.
 *
 * Every consumer (the `bun run test` wrapper, the query commands, the
 * privacy-contract gate) resolves these against the repo root so a run written
 * by one process is readable by the next without any path negotiation.
 */

/** Directory holding the current and previous test-run artifacts. */
export const REPORT_DIR = 'reports/test'

/** Directory holding one `<check>.log` per `scripts/check.sh` check. */
export const CHECKS_DIR = 'reports/checks'

/** Byte-complete combined stdout/stderr of the most recent run. */
export const LAST_RUN_LOG = 'reports/test/last-run.log'

/** Bun's JUnit reporter output for the most recent run. */
export const LAST_RUN_JUNIT = 'reports/test/last-run.junit.xml'

/** Structured report for the most recent run (`RunReportSchema`). */
export const LAST_RUN_JSON = 'reports/test/last-run.json'

/** The report rotated out of `LAST_RUN_JSON` when a new run is written. */
export const PREVIOUS_RUN_JSON = 'reports/test/previous-run.json'
