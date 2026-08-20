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

/**
 * Derive `scored` + `score` from raw counts. Shared by {@link mergeReports} and
 * {@link combineMergedScores} so a single-file run and a run assembled from several
 * files can never disagree about what a population of mutants scores.
 */
const finalizeCounts = (counts: Counts): MergedScore => {
  const scored = counts.killed + counts.survived + counts.noCoverage + counts.timeout
  return {
    ...counts,
    scored,
    score: scored === 0 ? 0 : (counts.killed + counts.timeout) / scored,
  }
}

export const mergeReports = (reports: readonly StrykerReport[]): MergedScore =>
  finalizeCounts(reports.flatMap(reportMutants).reduce(addMutant, ZERO_COUNTS))

// Ids of mutants that count AGAINST the mutation score: Survived and NoCoverage
// both sit in the `scored` denominator without contributing kills, so a residual
// declaration must cover both buckets. Mutants without a string id are dropped:
// they can never be set-matched against an agent's declared residual ids, and
// keeping them would make a full-coverage check silently unverifiable.
export const survivingMutantIds = (report: StrykerReport): string[] =>
  reportMutants(report).flatMap((mutant) =>
    (mutant.status === 'Survived' || mutant.status === 'NoCoverage') && typeof mutant.id === 'string'
      ? [mutant.id]
      : [],
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const COUNT_FIELDS = [
  'killed',
  'survived',
  'noCoverage',
  'timeout',
  'compileError',
  'ignored',
  'runtimeError',
  'pending',
  'total',
] as const

const addCounts = (a: Counts, b: MergedScore): Counts => ({
  killed: a.killed + b.killed,
  survived: a.survived + b.survived,
  noCoverage: a.noCoverage + b.noCoverage,
  timeout: a.timeout + b.timeout,
  compileError: a.compileError + b.compileError,
  ignored: a.ignored + b.ignored,
  runtimeError: a.runtimeError + b.runtimeError,
  pending: a.pending + b.pending,
  total: a.total + b.total,
})

/**
 * Pool independently-measured files into one score. Sums the raw counts and recomputes
 * the ratio — it does NOT average the per-file `score` values, which would weight a
 * two-mutant file the same as a two-hundred-mutant one. Used when a run's verdict is
 * assembled from files measured now plus files whose scores were carried over from an
 * earlier run, so the aggregate reads exactly as if every file had been measured together.
 */
export const combineMergedScores = (scores: readonly MergedScore[]): MergedScore =>
  finalizeCounts(scores.reduce(addCounts, ZERO_COUNTS))

/**
 * Shape guard for a `MergedScore` deserialized from an on-disk cache. Every count and the
 * score itself must be a finite number: a cache file is JSON written by an earlier run in
 * an environment we no longer control, and a non-finite score would silently poison every
 * comparison the ratchet makes against it.
 */
export const isMergedScore = (value: unknown): value is MergedScore => {
  if (!isRecord(value)) return false
  return [...COUNT_FIELDS, 'scored', 'score'].every((field) => {
    const entry = value[field]
    return typeof entry === 'number' && Number.isFinite(entry)
  })
}
