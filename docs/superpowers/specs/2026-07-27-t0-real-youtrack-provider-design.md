<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: real YouTrack provider inside the T0 story lane

**Status:** proposed

**Date:** 2026-07-27

## Context

The T0 story lane (`bun test:stories`) reports 0.0% line coverage for
`plugins/task-provider-youtrack` (4,060 lines) and 0.7% for
`plugins/task-provider-kaneo` (2,883 lines). The provider layer is invisible to
T0 by construction: `fixtures.registerTaskProvider()`
(`tests/stories/harness/fixtures.ts:471`) shadow-registers type `'kaneo'` with
`MemoryTaskProvider` and asserts it won ownership, so a real plugin factory can
never serve a scenario.

The original proposal was to build `createFakeYouTrack()` and
`createFakeKaneo()` in `tests/stories/harness/` following `fake-magi.ts`, add a
`given.realTaskProvider(...)` seam, and run `PARITY_GROUPS` against both real
providers. Recon changed the shape substantially. This spec records what
survived and what did not.

### Findings that reshaped the proposal

**The fetch seam already exists.** `tests/stories/harness/io-guard.ts:333`
replaces `globalThis.fetch` with the scenario's `StrictHttpDispatcher.fetch` for
the whole scenario. Both providers call bare `fetch`
(`plugins/task-provider-kaneo/client.ts:88`,
`plugins/task-provider-youtrack/client.ts:62`) rather than
`providerRuntimeDeps.fetch`, so real provider REST traffic already routes
through the dispatcher today. No new interception is needed. The only blocker is
the displaced factory.

**`fake-magi.ts` is the wrong model.** `PARITY_GROUPS` are round-trip
assertions — create, then read back and assert shape. That requires a *stateful
simulator* of the REST API that remembers what was POSTed. `fake-magi.ts` is
scripted one-shot expectations (`fake-magi.ts:254-381`), not a simulator.

**The YouTrack simulator already exists.**
`tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts` is a
661-line stateful fake YouTrack REST server driving the real `YouTrackProvider`
through `PARITY_GROUPS`, with a YouTrack-specific exclusion set
(`youtrack-parity-exclusions.ts`) and YouTrack-only custom-field groups
(`youtrack-custom-field-groups.ts`). It runs in the default in-process suite and
counts toward the `bunfig.toml` coverage floor. The 0.0% figure is a **T0-only**
number; YouTrack's provider code is already exercised, just not inside the
sandbox.

**Kaneo has no equivalent.** No fake Kaneo server exists anywhere in the tree.
Its in-process coverage comes from per-call `setMockFetch` unit tests.

**T0 coverage only counts story files.** `scripts/story/test-stories.ts:56-64` —
`--coverage` gates the run discovered by `discoverStories()`
(`tests/stories/**/*.story.test.ts`); harness contract tests are a separate
`--contracts` mode. A real-provider binding placed next to
`expectations.fake.test.ts` would not move the T0 number at all.

**Import direction is forced.** `scripts/story/inputs.ts:44-51` — captured story
inputs are `tests/stories/**` plus three explicit frozen lists.
`tests/plugins/**` is not among them, so a story importing the fake server from
its current location would either fail to resolve inside the read-only snapshot
or silently resolve unfrozen candidate bytes, breaking the refactor proof. The
simulator core must live under `tests/stories/harness/`, with the in-process
test importing it from there — the direction
`provider-conformance.test.ts:9` already uses for `PARITY_GROUPS`.

**This reopens a prior decision.**
`2026-07-25-youtrack-provider-conformance-lane-design.md` classified the
conformance lane as uncatalogued, reasoning that it cannot claim `@0` because
"the frozen sandbox forbids the live socket the fake server needs." Adding a
dispatcher transport removes exactly that blocker. The socket was the
obstacle, not the fake.

### Decisions taken during brainstorming

1. **Backend fidelity: stateful API simulator.** Not scripted expectations
   (parity groups cannot round-trip against them) and not recorded cassettes
   (YouTrack has no Docker lane to record from).
2. **Provider order: YouTrack first, Kaneo deferred to its own spec.** The
   sequencing was initially set as Kaneo-first, then reversed once the existing
   YouTrack simulator was found. YouTrack is now both the cheaper build (a
   transport swap) and the larger target (4,060 lines vs 2,883), and it validates
   the seam — the genuinely unknown part — before anyone authors Kaneo's REST
   semantics from scratch.
3. **Purpose: wiring proof first, coverage sweep second.** The T0 rerun of an
   in-process conformance suite re-executes already-proven provider code against
   the same authored fake to move a ratchet. T0's distinct value is real runtime
   composition. Both ship, but they are described separately and the wiring
   stories are the primary deliverable.
4. **Dispatcher mode: host-scoped catch-all only.** Not `expectAnyOrder`, which
   does not solve the problem — parity groups cannot enumerate their request sets,
   and a cache-warmed second call would fail as undeclared.
5. **Seam shape: a scenario option, not a `given.*` call.** Forced by activation
   timing; see below.

## Goals

- Exercise the real `YouTrackProvider` inside the T0 sandbox, reached through
  genuine runtime composition: manifest read → hash → approval → activation →
  `registerContributedTaskProviderType` → type resolution → capability gating →
  tool loop → provider → simulated REST.
- Give the frozen story harness a dispatcher mode that can host a stateful
  simulator, replacing strict FIFO for that traffic.
- Make the existing YouTrack conformance sweep reusable from T0 without
  duplicating it.
- Raise T0 production-code coverage as a measured consequence.

## Non-goals

- **Fidelity against a real YouTrack.** The simulator and the provider were
  authored against the same reading of the YouTrack API, so a shared misreading
  passes silently. No lane at any tier checks that reading; YouTrack has no
  container image. The existing fake's header states this and the T0 copy
  inherits it.
- **Kaneo.** Its simulator is a genuine ~600-line build and gets its own spec,
  written against a proven seam.
- **A promised coverage number.** See "Coverage expectations".
- **Replacing `MemoryTaskProvider`.** The memory fake remains the default for
  every existing scenario.

## Design

### 1. The seam

`given.realTaskProvider(...)` cannot work. Real plugins are discovered from
`plugins/` but only activated when approved in the DB
(`src/plugins/loader.ts:213` — "load and activate all approved+compatible
plugins"), and activation runs inside `createPapaiRuntime` during world startup
(`tests/stories/harness/world.ts:465`). `given.*` calls execute in the scenario
callback, after startup. The approval must exist before the runtime boots, which
makes this a world-construction fact:

```ts
scenario('SCN-...', async ({ given, when, then }) => { /* ... */ },
  { realTaskProvider: 'youtrack' })
```

`ScenarioOptions` is currently `{ debugEnabled?: boolean }`
(`tests/stories/harness/scenario.ts:303`). It gains `realTaskProvider?:
'youtrack'`, threaded through `executeScenario` → `createScenarioWorld` → a new
`fixtures.approveRealTaskProviderPlugin(type)` that runs real discovery against
`plugins/task-provider-youtrack`, takes the manifest hash off disk, and approves
it before `fixtures.registerTaskProvider()`.

The union is deliberately narrow — `'youtrack'` only. Kaneo's spec widens it.

**No ownership conflict.** `registerTaskProvider()` shadow-registers `'kaneo'`
and asserts it won ownership, throwing if a plugin owns that type
(`fixtures.ts:481-489`). The real YouTrack plugin registers `'youtrack'`, a
different type, so both coexist with no change to that assertion. Scenarios
wanting the memory fake keep getting it from `given.taskInstance()` (defaults to
`type: 'kaneo'`, `fixtures.ts:358`); YouTrack scenarios pass
`given.taskInstance({ type: 'youtrack' })`. Kaneo-first would have forced this
guard to be broken or special-cased.

**Provider config.** `given.taskInstance()` seeds `config: {}`, but
`YouTrackProvider` needs `baseUrl` and `token`
(`plugins/task-provider-youtrack/entry-runtime.ts:30-31`). The
`realTaskProvider` option seeds `{ baseUrl: 'https://youtrack.invalid', token:
'fake-token' }` — matching the in-process test's token
(`provider-conformance.test.ts:33`), and `.invalid` matching the io-guard convention
(`io-guard-probe.ts:435` uses `https://declared.invalid/`) — and registers
`youtrack.invalid` with `serveHost` at world construction.
`plugins/task-provider-youtrack/validate-config.ts` must be checked for host
constraints that reject that value during activation; if it has any, the fixture
uses whatever shape validation accepts.

### 2. The simulator

Mostly a move. `fake-youtrack-server.ts` is already transport-agnostic: `ctx =
{method, path, query, body, state}` (line 638), routes dispatch on that, and
`Bun.serve` is a wrapper at the bottom (622-648). The split follows the seam that
already exists:

| Unit | Location | Purpose |
| --- | --- | --- |
| simulator core | `tests/stories/harness/fake-youtrack/` | state, routes, `handle(ctx)`, `reset()`; transport-free; becomes frozen story input |
| `serveOverHttp()` | same directory | the current `Bun.serve` wrapper, for the in-process conformance test |
| `createFakeYouTrackResponder()` | same directory | adapts `Request` → `ctx` → `Response` for `http.serveHost()` |

The responder is the only genuinely new code and it is small: parse URL, read
body, call `handle`, return the response the router already builds.
`provider-conformance.test.ts` changes only its import path.

`max-lines` is **off** under `tests/**` (`.oxlintrc.json:52-63`), so the
661-line file is not forcing a split. Split it lightly along the state/routes
line for readability, but keep the diff conservative: every byte moved becomes
frozen and re-baselined.

**Reset semantics simplify at T0.** In-process, `provider-conformance.test.ts:31`
calls `fake.reset()` per test because the server outlives the suite. A scenario
*is* a fresh world, so the T0 responder constructs fresh state per scenario and
`reset()` is never called. No shared-state hazard.

**Unknown routes stay loud.** The router already 404s unrecognized paths
(`fake-youtrack-server.ts:643`), which is what recovers the strictness
`serveHost` gives up.

### 3. `serveHost` on the dispatcher

`strict-http.ts` is strict FIFO with exact `(method, url)` matching at
`expectations[consumed]`, and `verifyConsumed()` requires every declared
expectation to fire exactly once. A stateful simulator violates all three: the
requests `YouTrackProvider` will make, their order, and their count are
emergent and cache-state-dependent (`bundle-cache.ts`).

```ts
export type StrictHttpDispatcher = Readonly<{
  expect(request: StrictHttpExpectation, respond: Responder): void
  serveHost(host: string, respond: Responder, options?: Readonly<{
    allowZeroRequests?: boolean
    allowRedirect?: boolean
  }>): void
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  verifyConsumed(): void
  idle(): Promise<void>
}>
```

**A simulated host is claimed exclusively.** `fetch()` checks host-scoped
responders before the FIFO queue. To keep that from becoming a silent-shadowing
trap, mixing the two on one host throws at *declaration* time — `serveHost` on a
host that already has expectations, or `expect()` on an already-simulated host —
rather than producing a confusing "expected X but received Y" later.

**`verifyConsumed()` absorbs the min-one-request check** rather than gaining a
sibling. It already runs from the cleanup coordinator (`world.ts:421`), so no
call-site changes: it asserts the FIFO remainder is empty *and* that every
registered host saw at least one request unless `allowZeroRequests` was passed.
That is the guard against a story silently ceasing to exercise the provider
while still reporting green.

**No event-payload changes.** `http.request` and `http.response` keep their exact
current shapes (`strict-http.ts:69-72`, `:103`), so existing trace assertions in
`strict-http.test.ts` and the io-guard probes are untouched. Host-served requests
are recorded identically, keeping the diagnostic trace complete. In-flight
tracking and `idle()` are unchanged.

**Side benefit.** FIFO exact-position matching fails on *concurrent* requests
regardless of order tolerance. `bundle-cache.ts` warming several field bundles is
exactly that shape; `serveHost` makes it a non-issue.

### 4. Stories and catalog records

**Wiring stories** — the primary deliverable. Four scenarios, each with
`{ realTaskProvider: 'youtrack' }`, driving the real provider through the tool
loop:

| Scenario id | Proves |
| --- | --- |
| `SCN-task-youtrack-real-create` | discovery → approval → activation → type registration; a create-task turn lands a POST on the simulator and the reply carries the mapped task |
| `SCN-task-youtrack-real-fields` | reading back a task with custom fields through the runtime: `field-engine.ts`, `custom-field-values.ts`, `bundle-cache.ts` |
| `SCN-task-youtrack-real-error` | simulator 4xx → `classify-error.ts` → user-facing reply, end to end |
| `SCN-task-youtrack-real-gating` | a capability YouTrack does not declare is absent from the assembled toolset |

Four new `CATALOG_SCENARIO_IDS` entries in `tests/stories/catalog/coverage.ts`,
tier 0, story ids under `tests/stories/` per `TIER_SUITE_ROOTS`.

**The conformance sweep**, grouped by domain. `PARITY_GROUPS` minus
`YOUTRACK_PARITY_EXCLUSIONS` plus `youtrackCustomFieldGroups` is roughly 25+
groups. One catalog record each is bookkeeping churn for little signal; one
record for all of them loses failure locality. Six scenarios matching the
`tests/stories/harness/parity/expectations/` module split — tasks, search,
comments, relations, projects, errors — is the middle, and it mirrors structure
that already exists. Those six get catalog records too, bringing the total added
to `CATALOG_SCENARIO_IDS` to ten.

`ParityHarness` takes a `provider` directly (`parity/group.ts:9-12`), so these
resolve it through the registry and then bypass the tool loop. The sweep is
therefore a conformance-and-coverage pass, not a wiring proof. Both are worth
having; they are not the same thing and should not be reported as such.

**Bookkeeping that does not change:** adding YouTrack-only groups leaves
`PARITY_GROUPS.length` untouched, so the hardcoded `29` and `>= 19` assertions in
`expectations.fake.test.ts:23-30` stay valid.

## Coverage expectations

The original estimate was +9 to +10.5pp for both providers. This spec does not
commit to a number, for YouTrack or in total.

Parity groups only touch the `TaskProvider` interface. YouTrack's line count is
dominated by modules a T0 interface sweep may never reach: `query-builder.ts`,
`phase-five-provider.ts`, `dedicated-fields.ts`, `prompt-addendum.ts`. The four
wiring stories reach some of that, the sweep reaches the mapping layer, and the
remainder stays dark.

The implementation plan records the measured delta from a green
`bun test:stories:coverage` run and raises
`scripts/story/coverage-floor.json` from it via `bun coverage:ratchet:stories`.
Writing a target into the spec would make the number the goal, which is the
failure mode decision 3 rejected.

## Verification

In order:

1. `bun test` — the moved in-process conformance test still passes.
2. `bun test:stories:contracts` — harness contract tests, including new
   `serveHost` coverage in `strict-http.test.ts`.
3. `bun test:stories` — the new scenarios.
4. `bun test:stories:coverage` — measure.
5. `bun coverage:ratchet:stories` from that green run, then commit the
   `coverage-floor.json` change.

New harness contract tests to add: `serveHost` routing, the
declaration-time throw on mixing `expect`/`serveHost` per host, the
min-one-request assertion in `verifyConsumed()`, `allowZeroRequests`, and the
responder adapter's `Request` → `ctx` translation.

## Risks

| Risk | Handling |
| --- | --- |
| Simulator and provider share a misreading of the YouTrack API | Accepted and documented; no lane can detect it without a container image. Do not describe this lane as provider-real. |
| Widening the dispatcher weakens "undeclared HTTP fails" | Host registration is explicit, nothing is open by default, the router 404s unknown paths, and every request is still recorded. |
| Frozen-tree churn blocks an in-flight refactor qualification | Land on master, record manifest `treeHash` and baseline SHA, then rebase. See below. |
| Coverage delta lands well short of the estimate | Spec commits to no number; plan records the measurement. |
| `validate-config.ts` rejects `youtrack.invalid` during activation | Checked during implementation; fixture adapts to whatever validation accepts. |

## Freeze and baseline procedure

The moved simulator, the new stories, and edits to `scenario.ts`,
`strict-http.ts`, and `fixtures.ts` all change the frozen story tree hash. The
sequence matters:

1. Land every frozen-input change on master.
2. Record the manifest `treeHash` and baseline SHA there.
3. Rebase any in-flight refactor onto that commit and run compatibility against
   that SHA.

A ref predating the frozen inputs is incompatible and reports them as added.

Additions are reachable from stories rather than from `scripts/story/**`, so
`tests/scripts/story-enforcement-imports.test.ts` should need no change —
confirm during implementation rather than assuming.

## Follow-up work

- **Kaneo T0 simulator** — its own spec, written against the proven seam.
  Requires resolving the `'kaneo'` ownership assertion in
  `registerTaskProvider()` that YouTrack sidesteps.
- **`expectAnyOrder`** — deliberately not built. If a magi-shaped need for an
  unordered-but-enumerable expectation set appears, it is a small separate
  change.
