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
 * written BEFORE its implementation began. A `declared-unmet` criterion therefore carries a
 * `predicateRule` instead of a predicate. Once that predicate is authored in the criterion's
 * own follow-on spec it is appended to `predicate-registrations.ts` and the criterion becomes
 * `predicate-registered`: the bar is frozen, the evidence is still absent. Promotion to
 * `implemented` must satisfy that exact registered predicate — asserted verbatim in
 * `registry.test.ts`.
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

/**
 * The four criteria whose predicates were authored in the Gate 0 spec itself, where the promotion
 * rule permitted it because the outcome was already known and uncontested. They have no entry in
 * `predicate-registrations.ts` and are exempt from the verbatim check.
 *
 * Backdating registrations for them was rejected: it would fabricate a pre-registration that never
 * happened, in the one artifact whose entire value is that it does not lie. This list is itself a
 * frozen contract term — `registry.test.ts` asserts its exact contents, so growing it to smuggle a
 * criterion past the verbatim check fails CI.
 */
export const GATE0_IMPLEMENTED: readonly CriterionKey[] = [
  'scope-isolation',
  'erasure',
  'provenance',
  'reproducibility',
]

export type Criterion = Readonly<{
  key: CriterionKey
  status: 'implemented' | 'predicate-registered' | 'declared-unmet'
  /** Required iff implemented or predicate-registered. The standard this criterion is held to. */
  passPredicate: string | null
  /** Required unless implemented. Why no test body exists yet. */
  blocker: string | null
  /** Required iff declared-unmet. When its predicate must be authored. */
  predicateRule: string | null
  /** Executed criterion x scenario cells. Non-empty iff implemented. */
  shapes: readonly ShapeKey[]
  /**
   * Cells a frozen predicate demands that have no case yet. Non-empty iff predicate-registered.
   * These MAY name shapes that are still `declared-unimplemented`: registering a cell is a
   * promise to build the fixture, not a claim that it exists. Promotion moves keys from here
   * into `shapes`.
   */
  registeredShapes: readonly ShapeKey[]
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
    registeredShapes: [],
  },
  {
    key: 'erasure',
    status: 'implemented',
    passPredicate:
      'A purged id is unreachable via lexical, dense, listMemoryRecords (every status), summary, and profile — each asserted independently — and is not recaptured afterwards.',
    blocker: null,
    predicateRule: null,
    shapes: ['multilingual', 'adversarial-erasure'],
    registeredShapes: [],
  },
  {
    key: 'provenance',
    status: 'implemented',
    passPredicate:
      'Every recalled record resolves to its stored source and evidence; no derived text surfaces without a resolvable record.',
    blocker: null,
    predicateRule: null,
    shapes: ['tool-result', 'multilingual'],
    registeredShapes: [],
  },
  {
    key: 'capture-idempotency',
    status: 'implemented',
    passPredicate:
      'Replaying an identical capture input, repeatedly and with ingest order reversed relative to event time, yields exactly one canonical event per idempotency identity, and the projection snapshot after N replays is byte-identical to the snapshot after one. Supersession and validity resolve by event time, never by ingest order. Every suppressed replay is observable as a duplicate suppression, never as a silent success.',
    blocker: null,
    predicateRule: null,
    shapes: ['duplicate-out-of-order', 'long-horizon'],
    registeredShapes: [],
  },
  {
    key: 'reproducibility',
    status: 'implemented',
    passPredicate:
      'Identical corpus and embedding identity yield identical ordered recall; absent or incompatible embeddings degrade to lexical without losing order determinism.',
    blocker: null,
    predicateRule: null,
    shapes: ['missing-embedding', 'multilingual'],
    registeredShapes: [],
  },
  {
    key: 'races',
    status: 'predicate-registered',
    passPredicate:
      'For every interleaving of an erasure request with an in-flight capture of the same subject or evidence, held at B1–B5, the terminal state is erased: no canonical event, outbox item, projection row, or index entry for the tombstoned identity survives, and the losing writer reports a tombstoned suppression or a failure, never success. Concurrent captures of one idempotency identity produce exactly one canonical event. No interleaving reaches a state that neither serial order can reach.',
    blocker: 'Needs a concurrency harness; forget-versus-ingest interleavings were never executed (05 §Security).',
    predicateRule: null,
    shapes: [],
    registeredShapes: ['adversarial-erasure', 'multi-party'],
  },
  {
    key: 'crash-recovery',
    status: 'predicate-registered',
    passPredicate:
      'B1 is unreachable: no fault can leave a canonical event without its outbox item, or the reverse. For faults at B2–B5, restart converges the projection snapshot to the fault-free snapshot for the same input; canonical evidence committed before the fault is still enumerable; every outbox item is either complete or pending with its retry visible, never silently dropped; tombstones registered before the fault still suppress recapture after restart; and at-least-once redelivery produces no duplicate canonical event.',
    blocker: 'Needs fault injection between canonical and derivative writes (05 §Crash).',
    predicateRule: null,
    shapes: [],
    registeredShapes: ['long-horizon', 'duplicate-out-of-order'],
  },
  {
    key: 'migration',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs schema/embedding/tokenizer version fixtures and a rollback path (05 §Crash).',
    predicateRule: PREDICATE_RULE,
    shapes: [],
    registeredShapes: [],
  },
  {
    key: 'backup-restore',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'The 06 §6 retention and later-erasure policy for WAL, backups, and replicas is undefined.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
    registeredShapes: [],
  },
  {
    key: 'load',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs a production-shaped SQLite profile; the 100k evidence is a serial fresh-worker workload.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
    registeredShapes: [],
  },
  {
    key: 'reader-quality',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Gated on the P1 shadow-log screen; no live reader, extractor, or judge exists.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
    registeredShapes: [],
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
  { key: 'duplicate-out-of-order', status: 'implemented', blocker: null },
  { key: 'adversarial-erasure', status: 'implemented', blocker: null },
  { key: 'long-horizon', status: 'implemented', blocker: null },
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

export function registeredCriteria(): readonly Criterion[] {
  return CRITERIA.filter((c) => c.status === 'predicate-registered')
}
