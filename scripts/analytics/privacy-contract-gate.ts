// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The 17-control privacy contract, proved against the run that gates the release.
 *
 * This used to be a test that spawned `bun test <fixture>` for each of 57 proof files —
 * every one of which the parent suite had just run. Those nested runs cost 110s of a
 * 371s suite, a third of all in-test time, and re-proved nothing: they re-executed work
 * the same invocation had already done, purely to make the control→proof link explicit.
 *
 * Reading the run's own report is both cheaper and a stronger claim. Before, the contract
 * proved the fixtures pass *in a fresh process*; now it proves they passed *in the run
 * being gated*. The 17 rows, the proof-point requirements and the release-blocking status
 * are unchanged — only the evidence got closer to the thing it certifies.
 *
 * It fails closed. A missing, stale, subset-scoped, or load-broken report is not "no
 * evidence of a problem", it is "no evidence at all", and the two must never look alike.
 */

import fs from 'node:fs'
import path from 'node:path'

import { computeFingerprint, defaultFingerprintDeps } from '../test/fingerprint.js'
import { LAST_RUN_JSON } from '../test/paths.js'
import { readReport } from '../test/report.js'
import type { RunReport } from '../test/report.js'
import { privacyContractFixtures } from './privacy-contract-table.js'

/**
 * How many problems the CLI prints before deferring to a count.
 *
 * `evaluatePrivacyContractGate` always returns the complete list — a caller reasoning
 * about the result needs all of it. But a stale or subset-scoped report makes all 57
 * fixtures trivially unproven, and burying the two lines that actually explain the
 * refusal under 57 that repeat it is the same failure this branch is about.
 */
const MAX_PRINTED_PROBLEMS = 8

export interface PrivacyContractGateInput {
  report: RunReport | null
  /** Fingerprint of the working tree right now, to catch a report the tree has outrun. */
  currentFingerprint: string
  fixtures: readonly string[]
}

export interface PrivacyContractGateResult {
  ok: boolean
  problems: string[]
}

export interface PrivacyContractGateDeps {
  readFile: (path: string) => string | null
  fingerprint: () => string
  write: (text: string) => void
}

/** Conditions that make the report unusable as evidence, independent of any fixture. */
const reportProblems = (report: RunReport, currentFingerprint: string): string[] => {
  const problems: string[] = []

  if (report.scope.kind !== 'full') {
    const paths = report.scope.paths.join(', ')
    problems.push(
      `the recorded run covered only ${paths} — the contract needs a full-suite run; re-run \`bun run test\``,
    )
  }

  if (report.fingerprint !== currentFingerprint) {
    problems.push(
      `the recorded run is stale: source files changed since it (fingerprint ${report.fingerprint} → ` +
        `${currentFingerprint}); re-run \`bun run test\``,
    )
  }

  for (const error of report.runErrors) {
    const file = error.file ?? '(unknown file)'
    problems.push(`${file} failed to load in the recorded run, so its tests never ran — ${firstLine(error.message)}`)
  }

  return problems
}

const firstLine = (message: string): string => message.split('\n')[0] ?? message

/** One problem per fixture that cannot be shown green, naming the fixture. */
const fixtureProblems = (report: RunReport, fixtures: readonly string[]): string[] => {
  const problems: string[] = []
  for (const fixture of fixtures) {
    const record = report.files[fixture]
    if (record === undefined) {
      problems.push(`${fixture} did not run in the recorded run, so its control is unproven`)
      continue
    }
    if (record.failures > 0) {
      problems.push(
        `${fixture} failed in the recorded run (${String(record.failures)} failing) — its control is broken`,
      )
    }
  }
  return problems
}

/**
 * Every problem, not just the first. A release gate that stops at the earliest failure
 * turns one run into N runs, which is the habit this whole change set exists to break.
 */
export function evaluatePrivacyContractGate(input: PrivacyContractGateInput): PrivacyContractGateResult {
  const report = input.report
  if (report === null) {
    return {
      ok: false,
      problems: [`no usable report at ${LAST_RUN_JSON} — run \`bun run test\` before the privacy-contract gate`],
    }
  }

  const problems = [...reportProblems(report, input.currentFingerprint), ...fixtureProblems(report, input.fixtures)]
  return { ok: problems.length === 0, problems }
}

/** Reads the report through the injected seams and reports. `0` passes, `1` blocks. */
export function runPrivacyContractGate(deps: PrivacyContractGateDeps): number {
  const fixtures = privacyContractFixtures()
  const result = evaluatePrivacyContractGate({
    report: readReport(LAST_RUN_JSON, { read: deps.readFile }),
    currentFingerprint: deps.fingerprint(),
    fixtures,
  })

  if (result.ok) {
    deps.write(`privacy contract: 17 controls proved by ${String(fixtures.length)} fixtures, all green in the last run`)
    return 0
  }

  deps.write('privacy contract: BLOCKED')
  for (const problem of result.problems.slice(0, MAX_PRINTED_PROBLEMS)) deps.write(`  - ${problem}`)
  const hidden = result.problems.length - MAX_PRINTED_PROBLEMS
  if (hidden > 0) deps.write(`  … ${String(hidden)} more`)
  return 1
}

const readTextFile = (absolute: string): string | null => {
  try {
    return fs.readFileSync(absolute, 'utf8')
  } catch {
    return null
  }
}

function main(): void {
  const cwd = path.resolve(import.meta.dir, '..', '..')
  process.exitCode = runPrivacyContractGate({
    readFile: (relPath: string): string | null => readTextFile(path.resolve(cwd, relPath)),
    fingerprint: (): string => computeFingerprint(defaultFingerprintDeps(cwd)),
    write: (text: string): void => {
      console.log(text)
    },
  })
}

if (import.meta.main) main()
