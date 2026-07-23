<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Tier 1 provider-real parity lane

**Status:** proposed

**Date:** 2026-07-23

## Context

This is the first tier cycle under the tier expansion roadmap
(`2026-07-23-tier-expansion-roadmap-design.md`), which set the queue
T1 → T2 → T3 → T4 and mandated that each tier gets its own spec→plan cycle. The
tier-aware ledger (Deliverable 1) has landed: every executable catalog record
now carries a `provingTier`, and the runner prints five per-tier totals — all
currently `T0`, because no higher-tier lane exists yet.

T1's roadmap row names two pieces of work: retrofit the ten-suite `tests/e2e`
Docker-Kaneo lane into the catalog, and build a fake-fidelity **parity lane**.
The roadmap's rule 1 permits T1 to split these. **This spec covers the parity
lane only.** The `tests/e2e` retrofit is deferred to its own later cycle (T1b),
recorded in Out of scope.

The parity lane is the higher-value half. The roadmap named the motivating
regression precisely: F2b1/F2b2 grew `MemoryTaskProvider` to roughly fifteen
method groups (1,297 lines of hand-written Kaneo semantics — filter, sort, and
paging all re-coded), and twenty-two `SCN-task*` stories now assert against it,
but **nothing proves the fake matches real Kaneo**. If the fake drifts, all
twenty-two stories stay green while production breaks. Only a provider-real tier
detects this, and this cycle builds it.

Recon confirmed the two pre-work items the roadmap flagged as open are already
resolved in the tree:

- The Kaneo image is pinned: `ghcr.io/usekaneo/kaneo:2.7.2` in
  `docker-compose.yml`.
- The ten suites are already consolidated behind one aggregator
  (`tests/e2e/e2e.test.ts`) with shared container lifecycle in
  `tests/e2e/global-setup.ts`.

Both `MemoryTaskProvider` and `plugins/task-provider-kaneo/provider.ts`'s
`KaneoProvider` implement the same `TaskProvider` interface
(`src/providers/types.ts`), so a single provider-agnostic contract suite binds
to either by construction.

## Deliverable: the parity lane

### Scope and coverage bound

The coverage bound is fixed by the roadmap's own success metric, not chosen
here: **every `MemoryTaskProvider` method group that a `task-*` story asserts
against gets a parity counterpart, or a recorded reason it cannot.** That is the
~15–25 `@1` ids the roadmap budgeted — not the full ~60-method provider surface.
Method groups the fake implements but no story exercises are out of scope for
this cycle.

The parity groups are drawn from what the twenty-two `SCN-task*` scenarios
actually assert. The plan enumerates the exact group list against the story
files; the audit bar is the same the F-queue held — each minted id records why
it exists.

### The mechanism: one expectation set, two bindings

A shared, provider-agnostic **contract suite** states each expectation once
against the `TaskProvider` interface, with literal expected values after
canonicalization. It runs twice:

- **fake binding** → `MemoryTaskProvider`: hermetic, executes inside the Tier 0
  story run at zero marginal PR cost;
- **Kaneo binding** → `KaneoProvider` against Dockerized Kaneo `2.7.2`: the `@1`
  lane.

Binding is a constructor swap; both classes already implement `TaskProvider`, so
no adapter shims are introduced.

### Parity means normalized-shape equivalence

Byte-identical output is never asserted — real ids, timestamps, and
provider-assigned tie-break order differ by construction. Before comparison the
suite **canonicalizes** volatile fields (real ids and timestamps → stable
placeholders), then asserts against the declared expectation:

- field presence, types, and enum membership;
- filter, sort, and paging **semantics** (the same query returns the same
  logical result set);
- **relative** ordering only where the provider contract promises it; every
  other expectation declares itself order-insensitive explicitly.

Each side asserts against a _declared_ expectation rather than merely against
the other binding's output. This is what makes a failure legible: it names which
binding broke and against what — "Kaneo `listTasks` returned `status: null`,
expected an enum member" — rather than only "the two differ." A pure
differential deep-equal was rejected as the base mechanism for exactly this
reason; it may be layered onto specific high-risk groups in a later cycle if
drift there proves hard to pin with declared expectations.

### Frozen-tree placement (load-bearing)

The compat proof (0Q) hashes every regular file under `tests/stories/**`
byte-for-byte. The parity lane must respect a one-way dependency direction:

- The **shared expectation module lives inside the frozen `tests/stories/`
  tree.**
- The **Kaneo binding** — Docker-backed, candidate-side — **imports the
  expectations outward** from the frozen module.

Direction is frozen ← candidate, never the reverse. If the shared expectations
lived outside the frozen tree, Tier 0 story behavior would depend on unfrozen
bytes: someone could change what Tier 0 asserts without moving the `treeHash`,
the precise silent hole 0Q exists to close. Keeping expectations frozen and
importing them outward lets the Kaneo lane evolve freely while every byte Tier 0
relies on stays hashed.

Consequences, all deliberate:

- The parity expectation module is a **new frozen file**, so the `treeHash`
  moves again — one more argued exception in the same class the tier-aware
  ledger cycle established, recorded with the lane's PR per roadmap rule 7.
- The Kaneo binding file is **not** frozen (candidate-side infra, like the
  runner).
- The parity lane's Docker lifecycle **reuses** `tests/e2e`'s existing container
  setup and the pinned image rather than minting a second Kaneo harness.

### Catalog shape

One `@1` id per parity method group (`SCN-parity-*`, ~15–25 ids). The fake-bound
half is **not** re-catalogued: it is already covered by the twenty-two existing
`SCN-task*` `@0` ids, and a catalog record carries exactly one `provingTier`, so
the Kaneo-bound half must mint its own `@1` id rather than share an existing
`@0` one. The ledger therefore gains `@1` records without doubling, and every id
still maps to exactly one test.

The first `@1` record landing is the point at which the ledger gains genuine
tier diversity. That **retroactively gives the tier-derivation contract tests
their teeth** — closing the open Minor recorded against the tier-aware ledger
cycle (the totals/derivation tests could not distinguish per-record derivation
from a hardcoded constant while every record was `@0`) through real data rather
than a synthetic fixture. The runner line moves from `T1 0` to `T1 <n>`.

Minted ids extend `CATALOG_SOURCE` and each records its rationale, per the
roadmap's ledger-extension discipline.

## CI and budget

- T1 is a **PR gate**, budgeted (roadmap rule 5). The budget is **measured, not
  guessed**: the plan's first task measures the current `tests/e2e` wall-clock
  and declares the ceiling from that number. A lane that exceeds its ceiling
  moves to nightly rather than slowing the inner loop.
- **No retries** (rule 4). A parity scenario that cannot hold green is
  quarantined to nightly in the same PR that observes it, with a ledger note
  recording why.
- **Graceful degradation:** with Docker unavailable, the Kaneo half is skipped
  and the fake half still runs in Tier 0. The parity suite never makes Tier 0
  depend on Docker.

## Success metrics

- Every `MemoryTaskProvider` method group asserted by a `task-*` story has a
  Tier 1 parity counterpart, or a recorded reason it cannot.
- The catalog carries ~15–25 `@1` `SCN-parity-*` records, each with a rationale;
  the runner line shows a non-zero `T1` total.
- The tier-derivation contract tests carried forward from the tier-aware ledger
  cycle now fail under a mutated per-record tier lookup (they have teeth against
  real multi-tier data).
- The measured PR-gate wall-clock delta stays inside the ceiling the plan
  declares.
- A `treeHash` change is recorded with the PR as the intended, argued
  consequence of adding the frozen expectation module.

## Out of scope

- **The `tests/e2e` catalog retrofit (T1b).** Cataloguing the ten existing
  Docker-Kaneo suites as `@1` ids is deferred to its own cycle; this spec builds
  only the parity lane.
- **YouTrack parity.** No usable YouTrack container image exists today; YouTrack
  provider coverage stays forward-only, unchanged from the roadmap.
- **Full provider-surface parity.** Method groups the fake implements but no
  `task-*` story asserts against are not covered this cycle.
- **Tier 0 internal-fidelity drift (tracked follow-up).** The audit of the
  hermetic harness named two Tier-0-internal replicas that can silently drift
  from production: the frozen replica of `promotion-sweep.ts`'s private
  `defaultListScopes` (`tests/stories/harness/scenario.ts`'s
  `defaultPromotionScopes`) and the embeddings-HTTP DI-bypass
  (`when.captureSweep`). These are in the **memory** subsystem, not the
  task-provider surface, so the parity harness cannot exercise them; forcing
  them into this cycle would be cross-subsystem scope creep. Recorded here as a
  named follow-up so the next planning pass picks it up as its own small cycle.
- **A standalone `tsc` gate in the story runner.** The seam-API guarantee rides
  on Bun's load-time module resolution; keeping `bun typecheck` in the refactor's
  own CI remains the mitigation. Not a tier concern; noted so it is not
  rediscovered as a gap.

## Dependencies and risks

| Risk                                                              | Mitigation                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker flake reaches every PR once the parity lane gates          | Rule 4 quarantine plus the rule 5 measured budget; graceful degradation keeps the fake half green when Docker is down                                                                                       |
| Canonicalization hides a real drift (over-normalizing)            | Canonicalize only ids and timestamps; every other field is asserted. Order is asserted wherever the contract promises it, order-insensitive only where declared                                             |
| Kaneo `2.7.2` drift silently changes real behavior                | Version-pinned image; a provider upgrade is a deliberate, reviewed ledger event, per the roadmap                                                                                                            |
| The new frozen expectation module destabilizes the compat catalog | It is the sole frozen-tree change; the `treeHash` move is recorded with the PR as an argued exception, as the ledger cycle established                                                                      |
| Parity budget blows the PR ceiling                                | The measured ceiling decides; over-budget groups move to nightly. A golden-fixture PR gate with nightly re-record is the documented fallback if the whole lane cannot hold the ceiling                      |
| The fake-bound half diverges from its declared expectation        | The fake binding executes inside the Tier 0 story run, so a fake-vs-expectation divergence fails Tier 0 on every PR, not only the Docker-gated `@1` lane — the fake gets a hermetic tripwire it lacks today |
