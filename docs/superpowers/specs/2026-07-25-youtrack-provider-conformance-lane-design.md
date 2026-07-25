<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: YouTrack provider-conformance lane

**Status:** proposed

**Date:** 2026-07-25

## Context

This is "Item 4" of the tiering follow-up work, listed as "add a T1 YouTrack
parity lane." Recon reframed it: a true Tier 1 (provider-real) YouTrack lane is
not achievable today, and this spec builds the honest, achievable thing instead.

The Kaneo parity lane already exists and works
(`2026-07-23-tier1-provider-real-parity-design.md`). It states one set of
provider-agnostic contract expectations — `PARITY_GROUPS` in the frozen
`tests/stories/harness/parity/` module — and runs them against two bindings:
`MemoryTaskProvider` (the fake, hermetic, inside the Tier 0 story run) and a real
Dockerized Kaneo `2.7.2` (the `@1` lane in `tests/e2e/parity/`). Both classes
implement the same `TaskProvider` interface, so binding is a constructor swap.

`YouTrackProvider` (`plugins/task-provider-youtrack/provider.ts:86`) also
`implements TaskProvider`, so it fits the same harness structurally. But the T1
parity spec **explicitly deferred YouTrack** (its Out-of-scope): "No usable
YouTrack container image exists today; YouTrack provider coverage stays
forward-only." `YouTrackProvider` is entirely HTTP-driven (`youtrackFetch` in
`plugins/task-provider-youtrack/client.ts`), and its only current tests are
hand-written per-call `setMockFetch` mocks
(`tests/plugins/task-provider-youtrack/*.test.ts`). This spec reopens that
deferred decision with a bounded, hermetic answer.

### Decisions taken during brainstorming

Three forks were resolved with the user before this spec:

1. **Backend:** a **fake YouTrack REST server**, not a real container and not
   recorded cassettes. Chosen for full hermeticity. Its acknowledged limit: it
   cannot detect real-YouTrack drift (a fake can drift like the mocks it
   replaces). This is a request-building + response-mapping + contract-conformance
   lane, not a fidelity-against-reality lane.
2. **Classification:** **uncatalogued**. It does not claim `@1` (provider-real,
   ids under `tests/e2e/`) nor `@0` (the frozen sandbox forbids the live socket
   the fake server needs, and `@0` ids must sit under `tests/stories/`). It joins
   the ordinary `tests/plugins/…` integration tests that are outside the behavior
   ledger. No catalog records, no tier constant, no `treeHash` change.
3. **Scope:** reuse the shared `PARITY_GROUPS` as a third binding **plus** a
   small YouTrack-only extension for **custom-field mapping** (status/priority),
   the most YouTrack-distinct and error-prone provider code. Sprints, agiles, and
   saved-queries are deferred.

## Goals

- Exercise the **real** `YouTrackProvider` request-building and response-mapping
  end to end over HTTP, replacing scattered per-call `setMockFetch` assertions
  with one round-tripping contract suite.
- Prove `YouTrackProvider` conforms to the same normalized `TaskProvider`
  contract that `PARITY_GROUPS` already codify for Memory and Kaneo.
- Add focused coverage of YouTrack custom-field mapping (status/priority
  round-tripping through YouTrack's custom-field model).
- Stay fully hermetic: default `bun test`, no Docker, no network egress, no
  catalog/ledger/frozen-tree changes.

## Non-goals

- **Fidelity against a real YouTrack.** We author both the fake's payloads and
  the expectations; this lane cannot catch YouTrack-side drift. Recorded as an
  explicit limitation with a forward pointer.
- **A catalog/`@1`/`@0` record.** Uncatalogued by decision 2 above.
- **Sprints, agiles, saved-queries** parity — deferred to a later cycle.
- **Full YouTrack provider-surface coverage** — only the groups the shared
  contract covers plus the custom-field extension.
- **Any `src/` or `plugins/` production change.** The lane is test-only.

## Design

### 1. Placement and lane

The suite lives beside the existing YouTrack plugin tests:

```
tests/plugins/task-provider-youtrack/parity/
  fake-youtrack-server.ts          # stateful in-memory fake, Bun.serve
  fake-youtrack-server.test.ts     # unit tests for the fake itself
  youtrack-parity-exclusions.ts    # shared groups that can't map to YouTrack + reasons
  youtrack-custom-field-groups.ts  # the YouTrack-only extension groups
  provider-conformance.test.ts     # binding runner: YouTrackProvider vs the fake
```

It runs in the default `bun run test` (hermetic). No new CI job, no
`test:*` script, no catalog edit, no frozen file. Because nothing under
`tests/stories/**` changes, the `treeHash` does not move.

### 2. The fake YouTrack REST server

`fake-youtrack-server.ts` exports `startFakeYouTrackServer(): FakeYouTrackServer`
where `FakeYouTrackServer = { url: string; stop(): Promise<void>; reset(): void }`.
It is a **stateful** in-memory YouTrack served by `Bun.serve` on an ephemeral
port (port `0` → OS-assigned, so parallel workers never collide, per
`tests/CLAUDE.md`).

Stateful is required, not optional: the shared groups round-trip
(create → get → update → list-with-sort/filter/paging → delete; search; comments;
relations), so canned responses cannot satisfy them. The fake keeps an in-memory
store of issues, projects, comments, and issue-links, and honors:

- **Issue CRUD** at YouTrack's `POST/GET/DELETE /api/issues` and
  `/api/issues/{id}` surface.
- **The `fields=` projection** — YouTrack requires callers to request a field
  set; the fake returns exactly the requested projection shape (`$type`,
  `idReadable`, `customFields[]`, etc.) that `YouTrackProvider`'s mappers
  (`plugins/task-provider-youtrack/mappers.ts`) parse.
- **Custom fields** — status and priority are modeled as YouTrack custom-field
  values (`StateBundleElement` / `EnumBundleElement`-shaped), not top-level
  columns, so the provider's custom-field mapping code is what runs.
- **List sort / filter / paging** semantics enough for the corresponding shared
  groups (`$top`/`$skip`, query filtering, sort order).
- **Search** (`query=`) over the store.
- **Errors** — a controllable path returns a non-2xx status with a YouTrack-shaped
  error body (`{ error, error_description }`) so `YouTrackProvider`'s real
  `classify-error.ts` / `YouTrackApiError` path executes for the errors group.

The fake is authored to the shape `YouTrackProvider` actually requests and
parses; its own unit test (`fake-youtrack-server.test.ts`) pins that shape so a
drift in the fake is caught locally rather than surfacing as a confusing mapping
failure in the runner.

### 3. Binding runner

`provider-conformance.test.ts`:

1. `beforeAll`: `const fake = startFakeYouTrackServer()`.
2. Construct `const provider = new YouTrackProvider({ baseUrl: fake.url, token: 'fake-token' })`
   (`YouTrackConfig = { baseUrl, token }`).
3. For each applicable shared group in `PARITY_GROUPS` (imported outward from the
   frozen module), and for each custom-field extension group, run
   `group.run({ provider, projectId })` against a fresh fake project.
4. `afterAll`: `await fake.stop()`.

Assertions come from the groups themselves: each canonicalizes volatile fields
(`canonicalize`, `VOLATILE`, `VOLATILE_KEYS` from the frozen module) and asserts
the declared normalized expectation. The runner adds no new assertion logic — it
is a third binding of the existing mechanism.

### 4. Reuse and the frozen-tree direction

The shared expectations stay frozen; the YouTrack suite is a **candidate-side
consumer that imports them outward**, exactly the `frozen ← candidate` direction
the T1 parity spec established and that `tests/e2e/parity/` already uses. No
frozen byte changes, so 0Q's `treeHash` is untouched.

The YouTrack **custom-field extension groups**
(`youtrack-custom-field-groups.ts`) live in the (unfrozen) suite dir. They are
`ParityGroup`-shaped (reusing the `ParityGroup`/`ParityHarness` types and the
`required` helper from the frozen `group.ts`) but are YouTrack-specific and gate
nothing in Tier 0, so they do not belong in the frozen module.

### 5. Exclusions

`youtrack-parity-exclusions.ts` exports
`YOUTRACK_PARITY_EXCLUSIONS: readonly { group: string; reason: string }[]`,
mirroring the existing `PARITY_EXCLUSIONS` shape. A shared group that cannot map
to YouTrack is listed here with its reason rather than silently skipped; the
runner iterates `PARITY_GROUPS` minus the excluded ids. A test asserts every
excluded id names a real `PARITY_GROUPS` id (no stale exclusions) and that the
run set equals `PARITY_GROUPS` minus exclusions (no silent drops). The exact
exclusion set is enumerated during planning by running each shared group against
the fake and recording which cannot be satisfied and why — a real conformance
gap is reported, not excluded away.

### 6. What this lane proves — and does not

Stated in the suite's header comment and the spec so no reader over-reads it:

- **Proves:** `YouTrackProvider` builds correct requests, parses real-dialect
  YouTrack payloads, maps custom fields, and satisfies the normalized
  `TaskProvider` contract — through a real HTTP round-trip. A strict upgrade over
  per-call `setMockFetch` mocks.
- **Does not prove:** that the fake matches a live YouTrack. Both the fake and
  the expectations are authored here; YouTrack-side drift is invisible until a
  real-backend cycle exists. Forward pointer recorded.

## Error handling

- Provider-layer errors (4xx/5xx from the fake) flow through
  `YouTrackApiError` (`client.ts`) and `classify-error.ts`; the shared errors
  group asserts the normalized error behavior.
- The fake returns a well-formed error body on its error path so the mapping is
  exercised, not a transport failure.
- Fake lifecycle failures (port bind, unclean teardown) surface through the
  suite's `beforeAll`/`afterAll`; the fake binds an OS-assigned port to avoid
  cross-worker collisions.

## Testing / verification

- **Fake unit tests** (`fake-youtrack-server.test.ts`): the fake serves the
  `fields=` projection shape the provider expects; CRUD is stateful; the error
  path returns the YouTrack-shaped error body; `reset()` clears state.
- **Conformance run** (`provider-conformance.test.ts`): every applicable shared
  group and every custom-field extension group passes against `YouTrackProvider`
  bound to the fake.
- **Exclusion integrity**: `YOUTRACK_PARITY_EXCLUSIONS` ids are all real
  `PARITY_GROUPS` ids; run set = `PARITY_GROUPS` − exclusions (nothing silently
  dropped).
- **Custom-field extension**: status and priority set via `createTask`/`updateTask`
  round-trip back through `getTask`/`listTasks` as the normalized values, proving
  the custom-field mapping both directions.
- **Isolation-clean** (`tests/CLAUDE.md`): OS-assigned port, no fixed-wall-clock
  asserts, full teardown, no net `process.env` mutation.

## Out of scope

- **Real-backend YouTrack parity.** Remains forward-only; a future cycle with a
  usable image or recorded cassettes can add a genuine `@1` YouTrack lane. This
  spec's fake-server lane does not block or replace that.
- **Sprints, agiles, saved-queries** parity groups.
- **Catalog/ledger records** — uncatalogued by decision.
- **Any production `src/`/`plugins/` change** — test-only.

## Dependencies and risks

| Risk                                                                    | Mitigation                                                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The fake drifts from real YouTrack and the suite passes anyway          | Explicitly a non-goal and documented in-suite; the lane is sold as conformance, not fidelity. A real-backend cycle is the only fix and is named.        |
| The fake's payload shape diverges from what the provider parses         | `fake-youtrack-server.test.ts` pins the projection/custom-field shape independently, so fake drift fails locally, not as an opaque runner mapping error. |
| A shared group genuinely cannot map to YouTrack                         | It goes in `YOUTRACK_PARITY_EXCLUSIONS` **with a reason**; exclusion-integrity tests prevent silent drops or stale entries.                              |
| Building custom-field mapping coverage balloons scope                    | Extension limited to status/priority this cycle; sprints/agiles/saved-queries explicitly deferred.                                                      |
| Reaching into the frozen expectations couples the suite to Tier 0       | Import direction is `frozen ← candidate` (read-only, outward), the endorsed pattern `tests/e2e/parity/` already uses; no frozen bytes change.            |
| A future real YouTrack `@1` lane duplicates these groups                 | Intentional: the shared `PARITY_GROUPS` are the single source; a real lane would be a fourth binding of the same set, not a re-authoring.                |
