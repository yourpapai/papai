// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Append-only log of pass predicates registered BEFORE the criterion's implementation began
 * (`docs/superpowers/specs/2026-07-29-memory-gate1-predicate-registration-design.md`).
 *
 * This file is the anchor that makes the Gate 0 promotion rule binding rather than advisory:
 * `registry.test.ts` asserts that every criterion holding a `passPredicate` matches its entry
 * here verbatim, so a promotion commit cannot soften the bar while flipping the status.
 *
 * NEVER edit an existing entry. A predicate that proves unimplementable as written is
 * superseded by APPENDING a new entry with a later date and a stated reason; the original
 * stays. An in-place edit is invisible in review, which is the failure this file prevents.
 *
 * The predicates below cite observables O1-O6 and fault/interleave boundaries B1-B5. Those are
 * defined in section 1 of the design doc named above, and are binding on Gate 1's design.
 */

import type { CriterionKey } from './registry.js'

export type PredicateRegistration = Readonly<{
  /** ISO date the predicate was frozen. */
  date: string
  criterion: CriterionKey
  /** Repo-relative path of the spec that authored and reviewed this predicate. */
  spec: string
  /** Verbatim contract text. `registry.ts` must carry this string exactly. */
  predicate: string
}>

const GATE1_SPEC = 'docs/superpowers/specs/2026-07-29-memory-gate1-predicate-registration-design.md'

export const PREDICATE_REGISTRATIONS: readonly PredicateRegistration[] = [
  {
    date: '2026-07-29',
    criterion: 'capture-idempotency',
    spec: GATE1_SPEC,
    predicate:
      'Replaying an identical capture input, repeatedly and with ingest order reversed relative to event time, yields exactly one canonical event per idempotency identity, and the projection snapshot after N replays is byte-identical to the snapshot after one. Supersession and validity resolve by event time, never by ingest order. Every suppressed replay is observable as a duplicate suppression, never as a silent success.',
  },
  {
    date: '2026-07-29',
    criterion: 'races',
    spec: GATE1_SPEC,
    predicate:
      'For every interleaving of an erasure request with an in-flight capture of the same subject or evidence, held at B1–B5, the terminal state is erased: no canonical event, outbox item, projection row, or index entry for the tombstoned identity survives, and the losing writer reports a tombstoned suppression or a failure, never success. Concurrent captures of one idempotency identity produce exactly one canonical event. No interleaving reaches a state that neither serial order can reach.',
  },
  {
    date: '2026-07-29',
    criterion: 'crash-recovery',
    spec: GATE1_SPEC,
    predicate:
      'B1 is unreachable: no fault can leave a canonical event without its outbox item, or the reverse. For faults at B2–B5, restart converges the projection snapshot to the fault-free snapshot for the same input; canonical evidence committed before the fault is still enumerable; every outbox item is either complete or pending with its retry visible, never silently dropped; tombstones registered before the fault still suppress recapture after restart; and at-least-once redelivery produces no duplicate canonical event.',
  },
]

/** The most recent registration for a criterion, or undefined when it has none. */
export function registrationFor(key: CriterionKey): PredicateRegistration | undefined {
  return PREDICATE_REGISTRATIONS.findLast((entry) => entry.criterion === key)
}
