// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The frozen Gate 0 production-acceptance contract
 * (`docs/superpowers/specs/2026-07-29-memory-gate0-acceptance-harness-design.md`).
 *
 * Criteria come from `docs/research/agent-memory/06-recommendation.md` ("Acceptance gates
 * before broad production use"); scenario shapes come from the Gate 0 paragraph of
 * `docs/superpowers/plans/2026-07-26-memory-production-roadmap.md`.
 *
 * Promotion rule: a criterion may only reach `implemented` by satisfying a pass predicate
 * written BEFORE its implementation began. Unmet criteria therefore carry a `predicateRule`
 * instead of a predicate — their predicate must be authored in their own follow-on spec.
 * Promotion also appends a drift-log entry naming the predicate satisfied, matching the
 * append-only pattern the executed memory plans already use.
 * Adding or removing a key here is a deliberate, reviewable edit to a frozen contract.
 */

export type CriterionKey =
  | 'scope-isolation'
  | 'erasure'
  | 'provenance'
  | 'capture-idempotency'
  | 'reproducibility'
  | 'races'
  | 'crash-recovery'
  | 'migration'
  | 'backup-restore'
  | 'load'
  | 'reader-quality'

export type ShapeKey =
  | 'multilingual'
  | 'multi-party'
  | 'tool-result'
  | 'contradiction'
  | 'missing-embedding'
  | 'duplicate-out-of-order'
  | 'adversarial-erasure'
  | 'long-horizon'
  | 'abstention'

export const CRITERION_KEYS: readonly CriterionKey[] = [
  'scope-isolation',
  'erasure',
  'provenance',
  'capture-idempotency',
  'reproducibility',
  'races',
  'crash-recovery',
  'migration',
  'backup-restore',
  'load',
  'reader-quality',
]

export const SHAPE_KEYS: readonly ShapeKey[] = [
  'multilingual',
  'multi-party',
  'tool-result',
  'contradiction',
  'missing-embedding',
  'duplicate-out-of-order',
  'adversarial-erasure',
  'long-horizon',
  'abstention',
]

export type Criterion = Readonly<{
  key: CriterionKey
  status: 'implemented' | 'declared-unmet'
  /** Required iff implemented. The standard this criterion is held to. */
  passPredicate: string | null
  /** Required iff declared-unmet. Why no test body exists yet. */
  blocker: string | null
  /** Required iff declared-unmet. When its predicate must be authored. */
  predicateRule: string | null
  /** Declared criterion x scenario cells. Empty iff declared-unmet. */
  shapes: readonly ShapeKey[]
}>

export type Shape = Readonly<{
  key: ShapeKey
  status: 'implemented' | 'declared-unimplemented'
  blocker: string | null
}>

const PREDICATE_RULE =
  'Predicate MUST be written and reviewed in this criterion’s own follow-on spec, before its implementation begins.'

export const CRITERIA: readonly Criterion[] = [
  {
    key: 'scope-isolation',
    status: 'implemented',
    passPredicate:
      'No record in scope A is reachable from scope B through any channel — personal, group, and thread-scoped reads alike.',
    blocker: null,
    predicateRule: null,
    shapes: ['multilingual', 'multi-party'],
  },
  {
    key: 'erasure',
    status: 'implemented',
    passPredicate:
      'A purged id is unreachable via lexical, dense, listMemoryRecords (every status), summary, and profile — each asserted independently — and is not recaptured afterwards.',
    blocker: null,
    predicateRule: null,
    shapes: ['multilingual', 'adversarial-erasure'],
  },
  {
    key: 'provenance',
    status: 'implemented',
    passPredicate:
      'Every recalled record resolves to its stored source and evidence; no derived text surfaces without a resolvable record.',
    blocker: null,
    predicateRule: null,
    shapes: ['tool-result', 'multilingual'],
  },
  {
    key: 'capture-idempotency',
    status: 'declared-unmet',
    passPredicate: null,
    blocker:
      'no content-hash-keyed dedup at the write boundary; content collapse exists only in the LLM-gated group-promotion path',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'reproducibility',
    status: 'implemented',
    passPredicate:
      'Identical corpus and embedding identity yield identical ordered recall; absent or incompatible embeddings degrade to lexical without losing order determinism.',
    blocker: null,
    predicateRule: null,
    shapes: ['missing-embedding', 'multilingual'],
  },
  {
    key: 'races',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs a concurrency harness; forget-versus-ingest interleavings were never executed (05 §Security).',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'crash-recovery',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs fault injection between canonical and derivative writes (05 §Crash).',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'migration',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs schema/embedding/tokenizer version fixtures and a rollback path (05 §Crash).',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'backup-restore',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'The 06 §6 retention and later-erasure policy for WAL, backups, and replicas is undefined.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'load',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs a production-shaped SQLite profile; the 100k evidence is a serial fresh-worker workload.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'reader-quality',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Gated on the P1 shadow-log screen; no live reader, extractor, or judge exists.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
]

export const SHAPES: readonly Shape[] = [
  { key: 'multilingual', status: 'implemented', blocker: null },
  { key: 'multi-party', status: 'implemented', blocker: null },
  { key: 'tool-result', status: 'implemented', blocker: null },
  {
    key: 'contradiction',
    status: 'declared-unimplemented',
    blocker:
      'Belongs to capture-idempotency, demoted to declared-unmet; supersession is asserted as store behaviour, not as a Gate 0 cell.',
  },
  { key: 'missing-embedding', status: 'implemented', blocker: null },
  {
    key: 'duplicate-out-of-order',
    status: 'declared-unimplemented',
    blocker:
      'Belongs to capture-idempotency, demoted to declared-unmet; no write-boundary content dedup exists to exercise.',
  },
  { key: 'adversarial-erasure', status: 'implemented', blocker: null },
  {
    key: 'long-horizon',
    status: 'declared-unimplemented',
    blocker: 'Needs the canonical event log (Gate 1); a fixture-bounded version would overstate coverage.',
  },
  {
    key: 'abstention',
    status: 'declared-unimplemented',
    blocker: 'Needs a live reader (Gate 4); belongs to the reader-quality criterion.',
  },
]

export function criterionByKey(key: CriterionKey): Criterion {
  const found = CRITERIA.find((c) => c.key === key)
  if (found === undefined) throw new Error(`unknown criterion key: ${key}`)
  return found
}

export function implementedCriteria(): readonly Criterion[] {
  return CRITERIA.filter((c) => c.status === 'implemented')
}

export function implementedShapes(): readonly Shape[] {
  return SHAPES.filter((s) => s.status === 'implemented')
}
