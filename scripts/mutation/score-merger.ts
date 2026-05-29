// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface StrykerMutant {
  readonly id?: string
  readonly status?: string
}

export interface StrykerFileReport {
  readonly mutants?: readonly StrykerMutant[]
}

export interface StrykerReport {
  readonly files?: Record<string, StrykerFileReport>
}

export interface MergedScore {
  readonly killed: number
  readonly survived: number
  readonly noCoverage: number
  readonly timeout: number
  readonly compileError: number
  readonly ignored: number
  readonly runtimeError: number
  readonly pending: number
  readonly total: number
  readonly scored: number
  readonly score: number
}

type Counts = Omit<MergedScore, 'scored' | 'score'>

const ZERO_COUNTS: Counts = {
  killed: 0,
  survived: 0,
  noCoverage: 0,
  timeout: 0,
  compileError: 0,
  ignored: 0,
  runtimeError: 0,
  pending: 0,
  total: 0,
}

const addMutant = (counts: Counts, mutant: StrykerMutant): Counts => {
  const withTotal = { ...counts, total: counts.total + 1 }
  switch (mutant.status) {
    case 'Killed':
      return { ...withTotal, killed: withTotal.killed + 1 }
    case 'Survived':
      return { ...withTotal, survived: withTotal.survived + 1 }
    case 'NoCoverage':
      return { ...withTotal, noCoverage: withTotal.noCoverage + 1 }
    case 'Timeout':
      return { ...withTotal, timeout: withTotal.timeout + 1 }
    case 'CompileError':
      return { ...withTotal, compileError: withTotal.compileError + 1 }
    case 'Ignored':
      return { ...withTotal, ignored: withTotal.ignored + 1 }
    case 'Pending':
      return { ...withTotal, pending: withTotal.pending + 1 }
    case undefined:
      return { ...withTotal, runtimeError: withTotal.runtimeError + 1 }
    default:
      return { ...withTotal, runtimeError: withTotal.runtimeError + 1 }
  }
}

const hasMutants = (file: StrykerFileReport): file is { readonly mutants: readonly StrykerMutant[] } =>
  Array.isArray(file.mutants)

const reportMutants = (report: StrykerReport): readonly StrykerMutant[] =>
  Object.values(report.files ?? {}).flatMap((file) => (hasMutants(file) ? file.mutants : []))

export const mergeReports = (reports: readonly StrykerReport[]): MergedScore => {
  const counts = reports.flatMap(reportMutants).reduce(addMutant, ZERO_COUNTS)
  const scored = counts.killed + counts.survived + counts.noCoverage + counts.timeout
  return {
    ...counts,
    scored,
    score: scored === 0 ? 0 : (counts.killed + counts.timeout) / scored,
  }
}
