<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Gate 0 — production acceptance harness

**Status:** design

Implements Gate 0 of
[`2026-07-26-memory-production-roadmap.md`](../plans/2026-07-26-memory-production-roadmap.md).

## Problem

The roadmap forbids changing the memory representation before a production acceptance contract
exists. [`06-recommendation.md`](../../research/agent-memory/06-recommendation.md) names eleven
acceptance criteria; [`05-failure-catalog.md`](../../research/agent-memory/05-failure-catalog.md)
records that several were designed but never executed. Today there is no executable answer to "is
the memory subsystem Phase 0 ready?" — only prose scattered across a sealed research record.

The eleven criteria differ enormously in cost. Scope isolation and erasure are largely testable
against current code; load, backup/restore, and reader quality are each their own programme.
Building all eleven now is not viable, and building only the cheap ones while calling the gate
satisfied would be worse than building nothing.

The roadmap's own exit condition is narrower than the criteria list:

> **Exit:** the scenarios, expected outcomes, and pass/fail gates are **versioned** before canonical
> capture code is written.

Gate 0's job is to freeze the contract, not to turn all eleven criteria green.

## Goals

- Version the full contract: eleven criteria and nine scenario shapes, frozen before Gate 1 begins.
- Implement the five criteria and seven scenario shapes the current code can genuinely exercise.
- Make the six unmet criteria and two unimplemented shapes **visible and non-waivable**, each
  carrying a named blocker.
- Guarantee the standard for any future criterion is written **before** the code that must clear it.
- Produce an executable statement that Phase 0 is **not** passed.

## Non-goals

- Implementing the six unmet criteria. Each gets its own spec.
- Changing anything under `src/`. This adds tests, data, and a report script only.
- Claiming Phase 0 is passed, or transferring any sealed benchmark score to shipped code.
- Reader-level or answer-quality evaluation. That is `reader-quality`, gated on the P1 screen.

## Design

### 1. Registry — `tests/long-term-memory/acceptance/registry.ts`

Plain versioned data, the single source of truth for the frozen contract.

```ts
interface Criterion {
  readonly key: CriterionKey
  readonly status: 'implemented' | 'declared-unmet'
  readonly passPredicate: string | null // required iff implemented
  readonly blocker: string | null // required iff declared-unmet
  readonly predicateRule: string | null // required iff declared-unmet
  readonly shapes: readonly ShapeKey[] // declared cells; empty when unmet
}
```

**Eleven criteria**, from `06` "Acceptance gates before broad production use":

| Key                    | Status         | Blocker (when unmet)                        |
| ---------------------- | -------------- | ------------------------------------------- |
| `scope-isolation`      | implemented    | —                                           |
| `erasure`              | implemented    | —                                           |
| `provenance`           | implemented    | —                                           |
| `capture-idempotency`  | implemented    | —                                           |
| `reproducibility`      | implemented    | —                                           |
| `races`                | declared-unmet | needs a concurrency harness                 |
| `crash-recovery`       | declared-unmet | needs fault injection                       |
| `migration`            | declared-unmet | needs version fixtures                      |
| `backup-restore`       | declared-unmet | `06` §6 retention/erasure policy undefined  |
| `load`                 | declared-unmet | needs a production-shaped profile           |
| `reader-quality`       | declared-unmet | gated on the P1 screen                      |

**Nine scenario shapes**, from the roadmap's Gate 0 paragraph: `multilingual`, `multi-party`,
`tool-result`, `contradiction`, `missing-embedding`, `duplicate-out-of-order`,
`adversarial-erasure` are implemented; `long-horizon` (needs canonical events, Gate 1) and
`abstention` (needs a live reader, Gate 4) are declared but unimplemented.

### 2. Promotion rule

A criterion moves from `declared-unmet` to `implemented` only by satisfying a **pass predicate
written before its implementation began**.

- For the five implemented criteria, predicates are written now (§3), while the outcome is already
  known and uncontested.
- For the six unmet criteria, the registry records a `predicateRule` instead: the predicate MUST be
  written and reviewed in that criterion's own follow-on spec, **before** its implementation starts
  — never at promotion time.

This preserves the pre-registration property that the P1 shadow-log protocol already relies on: the
bar is always set before the code that has to clear it exists. It deliberately does not force
predicates for work whose shape is unknown, because a predicate authored blind degrades into prose
like "recovers correctly", which reads rigorous and decides nothing.

Two mechanics make the rule binding rather than advisory:

1. A criterion cannot hold `implemented` while `passPredicate` is absent — asserted in §5, so
   skipping predicate-writing fails CI instead of passing through review.
2. Promotion appends a drift-log entry naming the predicate satisfied, matching the append-only
   pattern the seven executed memory plans already use.

### 3. Scenario corpus — `tests/long-term-memory/acceptance/corpus.ts`

Shared fixture builders, one per implemented shape, seeding records, profile, and history for a
scope. Bilingual Cyrillic + Latin, matching the existing goldens.

**Synthetic only.** No production conversation data, consistent with every existing memory test and
with the content-free shadow log. This satisfies the roadmap's "privacy-reviewed" requirement by
construction rather than by process.

A `CORPUS_VERSION` constant is rendered by the report. Changing fixtures bumps it, so a shifting
corpus cannot silently change what "passing" meant.

### 4. Criterion suites — `tests/long-term-memory/acceptance/<criterion>.test.ts`

Each suite exports a partial `CASES` table keyed by shape and drives its `test()` calls from that
table, so the declared coverage and the executed coverage are the same object.

| Criterion             | Pass predicate                                                                                                                                                        | Shapes                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `scope-isolation`     | No record in scope A is reachable from scope B through any channel — personal, group, thread, guest.                                                                  | multilingual, multi-party           |
| `erasure`             | A purged id is unreachable via lexical, dense, `listMemoryRecords` (every status), summary, and profile — each asserted independently — and is not recaptured after.   | multilingual, adversarial-erasure   |
| `provenance`          | Every recalled record resolves to its stored source/evidence; no derived text surfaces without a resolvable record.                                                   | tool-result, multilingual           |
| `capture-idempotency` | Duplicate and out-of-order capture of identical content yields exactly one record with a deterministic content hash; a contradiction supersedes rather than duplicates. | duplicate-out-of-order, contradiction |
| `reproducibility`     | Identical corpus and embedding identity yield identical ordered recall; absent or incompatible embeddings degrade to lexical without losing order determinism.         | missing-embedding, multilingual     |

Every implemented shape appears in at least one cell.

The `erasure` predicate deliberately restates the guarantee already proven by
`durable-erasure.golden.test.ts` — Gate 0 registers it as a contract term so a later change cannot
weaken it silently.

### 5. Consistency invariants — `tests/long-term-memory/acceptance/registry.test.ts`

These make the contract self-enforcing:

- `implemented` implies a non-empty `passPredicate`; `declared-unmet` implies `blocker` and
  `predicateRule` present and `passPredicate` null.
- Every declared cell has a matching case in that criterion's exported table, and every exported
  case is declared — asserted in both directions.
- Every implemented shape appears in at least one declared cell; every deferred shape appears in
  none.
- Criterion and shape key sets match the frozen lists exactly, so adding or dropping one is a
  deliberate, reviewable edit rather than a side effect.

### 6. Report — `scripts/memory-acceptance.ts`, `bun run memory:acceptance`

Renders the corpus version, the criteria table with blockers, the shapes table, the coverage
matrix, and a summary line of the form `contract versioned = YES / production ready = NO (6 unmet)`.

**Exit code is always 0.** The report is informational; enforcement lives in the tests. This
mirrors `memory:shadow-funnel`, which renders mechanical preconditions but refuses to print a
verdict a human should adjudicate. The report counts and displays; it never declares readiness.

## Testing

Test-driven, per repo convention. The registry invariants (§5) are written first — they fail
against an empty registry, then pass as it is populated. Criterion suites follow, each driven from
its `CASES` table. The report script gets its own test asserting the rendered shape, following
`shadow-funnel-cli.test.ts`.

## Consequences

Gate 0's exit condition is met when the registry, corpus, five criterion suites, invariants, and
report are merged and versioned. Gate 1 may then begin.

The harness will report `production ready = NO` for the foreseeable future. That is the intended
output, not a defect: six criteria have no evidence, and the roadmap forbids treating the
representation as production-proven until they do. A future change that makes the report read
`YES` without six follow-on specs having landed is itself the bug.
