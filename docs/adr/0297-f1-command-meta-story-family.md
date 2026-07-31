<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0297: F1 Command-Surface and Meta-Tools Story Family — Behavioral Coverage for the Command Surface and the Tool-Disclosure/Meta-Tool Path

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

The coverage-expansion roadmap sequences its families by refactor risk, and **F1** (`meta-*` + `cmd-*`) goes first because `plugin-core-separation` rewires exactly what these scenarios observe: tool assembly and capability registration, progressive disclosure, result compaction, and the command surface. The executed catalog audit classified 17 of the 19 F1 scenarios as executable candidates (13 `executable-as-is`, plus 4 `needs-seam`: `meta-search-tools` needs `capability-ids`, `meta-expand-result` needs `compaction-trigger`, and both stop scenarios need `mid-turn-run-control`); `SCN-cmd-nerv` and `SCN-cmd-announce` stay pending as `blocked` (no production `/nerv` or chat `/announce` command exists).

The gap was that capability resolution failed for the two disclosure-injected meta tools (`search_tools`, `expand_result`) — `registerOfferedCoreToolCapabilities` runs against the gated, pre-disclosure tool set, so disclosure-injected tools were invisible to it — and the hermetic story harness had no way to express the four behaviors these 17 scenarios exercise: a substring reply matcher (for single-use-code replies), mid-turn run control (park a generation, inject `/stop`), a compaction-handle placeholder (decouple stories from the internal `res_<hex>` counter), and group-admin seeding (`auth.isGroupAdmin` resolves through the chat provider, which the scenario chat did not implement). The design (`docs/superpowers/specs/2026-07-19-f1-command-meta-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-19-f1-command-meta-story-family.md`) chose two one-line production registration seams, four targeted harness additions, two story files (14 command + 3 meta scenarios) driving the real registered handlers and the real disclosure/compaction path, and the 17-entry ledger move — taking the catalog from 32 to 49 executable scenarios and giving every seam the refactor touches a behavioral tripwire.

## Decision Drivers

- **Drive the real production paths, not a parallel surface.** Every scenario dispatches through the real registered command handlers (`when.message(user, ctx, '/cmd …')`) and the real `applyCompactionAndDisclosure`/`expand_result` loop; the harness only adds deterministic LLM scripting and seeding, never a second command or tool implementation.
- **Register only what the stories need.** `expand_result` gets a real `CORE_TOOL_CAPABILITIES` entry (it is in the offered set at registration time); `search_tools` gets one explicit `catalog.register(...)` because it is disclosure-injected and therefore invisible to the offered-set registration. `load_tool` deliberately gets no capability id — the scripted model's `autoLoadTools` path already exercises it (YAGNI).
- **Targeted harness additions, each contract-tested.** Four seams — `contains` matcher, `given.groupAdmin`, a gated scripted-LLM decision with `when.dispatchMessage`, and the `$compaction:latest` sentinel — each with a contract test in `tests/stories/harness/`, so the story corpus never depends on unverified harness behavior.
- **Never bake a secret into a story.** `/config` and `/dashboard` replies embed random single-use codes; stories assert static text with `.equals` and link shapes with `.contains`, never the code itself.
- **The gate must not deadlock `when.message`.** `when.message` settles synchronously, so a parked turn would deadlock it; the stop stories dispatch the work message and the `/stop` without settling (`when.dispatchMessage`) and call `world.settle()` explicitly after `gate.release()`.
- **Keep `/stop` ownership and the two pending scenarios as-is.** Any authorized member may stop a group thread's run (documented behavior); `SCN-cmd-nerv`/`SCN-cmd-announce` stay pending because their commands do not exist.

## Considered Options

### Option 1 — Two one-line production seams + four targeted harness additions + two story files over the real paths (chosen)

Register `expand_result` in `CORE_TOOL_CAPABILITIES` and `search_tools` via one explicit `catalog.register(...)`. Add `contains`, `given.groupAdmin`, the gated decision (`gateCall`/`nextGate`) with `when.dispatchMessage`, and the `$compaction:latest` sentinel — each contract-tested. Write `tests/stories/commands/surface.story.test.ts` (14 scenarios) and `tests/stories/meta/disclosure-and-compaction.story.test.ts` (3 scenarios) over the real handlers/disclosure/compaction loop, then move 17 audit records into the executable ledger.

- **Pros:** every scenario is a real refactor tripwire (commands, disclosure, compaction, capability resolution); the harness additions are minimal and reusable (the gate is also the future steering-injection hook); the production surface change is two lines; the ledger move is mechanical.
- **Cons:** the gate is a concurrent park/release primitive living in a test model, with teardown-leak interactions that must be handled; the disclosure stall window and the compaction counter are real production timing the stories must stay inside; the stop-story summaries depend on exactly which tools the disclosure walk loads.

### Option 2 — A `MemoryTaskProvider` knob to force compaction (rejected)

Give the in-memory task provider a per-task flag making one task's serialized tool result exceed `COMPACTION_THRESHOLD_BYTES` (8 000).

- **Pros:** deterministic, provider-local compaction trigger; no coupling to the real `create_task` description length.
- **Cons:** adds a harness-only provider surface that does not exist in production; the compaction path is better exercised through the real tool input it serves. Dropped in favor of a >8 000-byte `create_task` description through the real tool path (more behavioral, one less harness surface).

### Option 3 — Map `SCN-cmd-acp` as a second mapping of the integrations command story (rejected)

Reuse `tests/stories/integrations/runtime-extensions/command-prompt.story.test.ts` for `SCN-cmd-acp`.

- **Pros:** zero new story code for the ACP command scenario.
- **Cons:** the ledger asserts story-reference uniqueness, and the two stories test different things — the command-surface view (static text and disabled-context refusal) versus extension-registration semantics. A dedicated story is required.

## Decision

The chosen Option 1 shipped across two production registration seams, four harness additions (each contract-tested), two story files, and the 17-entry ledger move. What shipped:

1. **`meta.expand-result` capability registration.** `CORE_TOOL_CAPABILITIES` gains `'meta.expand-result': 'expand_result'` (`src/tools/core-capabilities.ts:15`), so `registerOfferedCoreToolCapabilities` maps the capability id to the `expand_result` wire tool whenever it is in the offered set.
2. **`meta.search-tools` capability registration.** One explicit `toolCapabilityCatalog.register('meta.search-tools', 'search_tools')` in `buildFullToolSet` (`src/llm-orchestrator-tools.ts:232`), after `applyCompactionAndDisclosure`; re-registering the same mapping per turn is idempotent.
3. **`contains` reply matcher.** `ReplyAssertion` gains `contains(expected)` (`tests/stories/harness/scenario.ts:269,432-435`), asserting a substring of the latest captured reply via `toContain`; contract-tested at `tests/stories/harness/scenario.test.ts:347-357`.
4. **`given.groupAdmin` fixture.** The scenario chat carries a `groupAdmins` set, an `isGroupAdmin` provider method, and an `addGroupAdmin` seed method (`tests/stories/harness/chat.ts:93,261,305-306`); `seedGroupAdmin` delegates to it (`tests/stories/harness/fixtures.ts:272,404-408`) and `given.groupAdmin` wires it through `scopedGroupId` (`tests/stories/harness/scenario.ts:118,512-515`); contract-tested at `tests/stories/harness/fixtures.test.ts:229-234`.
5. **Gated scripted-LLM decision.** A third `ModelDecision` kind `tool-gate` plus `gateCall`/`GatedToolCall` (`tests/stories/harness/scripted-llm.ts:15,18,71-75`); `doGenerate` parks the generation on a release/abort-aware gate (`:293-316`), `nextGate()` resolves it (`:325-330`), and `verifyConsumed` releases an unreleased gate and fails the story (`:331-338`); contract-tested at `tests/stories/harness/scripted-llm.test.ts:252-292`.
6. **`when.dispatchMessage`.** Dispatches a message through the real runtime without settling (`tests/stories/harness/scenario.ts:242,791-795`), leaving `world.settle()` as the stop stories' explicit synchronization point.
7. **`$compaction:latest` sentinel.** `COMPACTION_LATEST` plus `findCompactionHandle`/`latestCompactionHandle`/`resolveCompactionInput` (`tests/stories/harness/scripted-llm.ts:162-201`) substitute the sentinel with the most recent `CompactedEnvelope` handle (throwing when none was observed); contract-tested at `tests/stories/harness/scripted-llm.test.ts:438-478`.
8. **Command-surface story file.** `tests/stories/commands/surface.story.test.ts` (14 scenarios: help, start, config-dm, config-group, context, clear-self, clear-target-user, clear-all, clear-group-denied, dashboard, stop-noop, stop-graceful, stop-abort, acp).
9. **Meta-tools story file.** `tests/stories/meta/disclosure-and-compaction.story.test.ts` (3 scenarios: meta-search-tools, meta-load-tool, meta-expand-result).
10. **Ledger move.** The 17 `SCN-cmd-*`/`SCN-meta-*` entries move from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'` (`tests/stories/catalog/coverage.ts:521-608`); `SCN-cmd-nerv`/`SCN-cmd-announce` stay blocked (`:1177-1184`).

## Consequences

### Positive

- Every command handler, the progressive-disclosure walk, the compaction/`expand_result` loop, and both meta-tool capability resolutions now have a hermetic Tier-0 tripwire: a refactor that breaks the command surface, drops `search_tools`/`expand_result` from the capability catalog, or changes the disclosure/compaction contract fails a named scenario.
- The four harness additions are reusable beyond F1: `contains` serves any single-use-code reply, `given.groupAdmin` serves any group-admin-gated command, the gated decision is also the steering-injection hook for future mid-turn stories, and `$compaction:latest` decouples every future compaction story from the `res_<hex>` counter.
- The production change is two lines: one `CORE_TOOL_CAPABILITIES` entry and one `catalog.register(...)`. Capability resolution for the meta tools is now real, not faked.
- The harness additions are each pinned by a contract test in `tests/stories/harness/`, so the story corpus never depends on unverified harness behavior and a harness regression is caught at the contract tier.

### Negative

- **The gated decision is a concurrent park/release primitive in a test model.** It interacts with the I/O guard's leak checks; `verifyConsumed` must release-and-fail on an unreleased gate so teardown never leaves a parked promise. A story author who forgets `gate.release()` gets a clear "gate was never released" failure rather than a hang, but the primitive is more complex than the existing decision kinds.
- **Stop-story summaries depend on exactly what the disclosure walk loads.** The summary text is asserted exactly (a behavioral contract), so it tracks `load_tool` and the count of real tool calls; any change to the disclosure walk or the summary wording forces a story update.
- **The catalog totals move with every family.** The plan's 49/128 target was the post-F1 state; subsequent families (F2–F8) and the tier-1/2/3 parity lanes have since grown the ledger well past it, so the F1 contribution is only visible by diffing the family's 17 mappings, not by reading the current totals line.

### Risks

- **Disclosure-stall timing is real.** The `meta-search-tools` story must complete within the disclosure stall window (`DISCLOSURE_STALL_STEPS` = 2) or disclosure latches open; the scripted sequence is short enough by construction and the contract test pins it, but a future disclosure change could widen the window the story relies on.
- **`search_tools` is registered unconditionally.** Because `maybeApplyDisclosure` injects `search_tools` unconditionally, the unconditional registration is equivalent to the conditional form the design proposed; if disclosure ever becomes conditional on context, the registration must follow it or capability resolution will succeed in a context where `search_tools` is not advertised.
- **`/config`-link stories need a public-base-url seam.** The sandbox child env lacks `SETTINGS_PUBLIC_BASE_URL`; the stories set it through `given.publicBaseUrl` (restored in `fixtures.teardown`). A future story that forgets the fixture silently gets a malformed link rather than a clear failure.

## Related Decisions

- [ADR-0183](0183-tool-context-reduction-part1-flags-and-result-compaction.md) — Tool-Context Reduction — Part 1: Feature Flags and Result Compaction: established the `expand_result` pager and the `COMPACTION_THRESHOLD_BYTES` envelope this family's `meta-expand-result` scenario exercises end to end; the `$compaction:latest` sentinel resolves the handle the compaction wrapper produces.
- [ADR-0184](0184-tool-context-reduction-part2-progressive-disclosure-semantic-tool-retrieval.md) — Tool-Context Reduction — Part 2: Progressive Disclosure and Semantic Tool Retrieval: established the `search_tools`/`load_tool` disclosure injection and the stall-fallback contract this family's `meta-search-tools`/`meta-load-tool` scenarios drive; the `meta.search-tools` capability registration seam this ADR adds is what makes disclosure-injected `search_tools` resolvable by capability id.
- [ADR-0166](0166-storybook-harness-pr1.md) — Storybook Harness — PR 1 (Vertical Slice): the origin of the hermetic story harness this family extends (scripted model, scenario API, world/fixtures split).
- [ADR-0282](0282-hermetic-e2e-master-baseline.md) — Hermetic E2E Master Baseline — Shared Lifecycle Runtime and Story Harness: the shared lifecycle runtime and story-harness foundation these scenarios compose against.
- [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) — Hermetic Story Process Sandbox — Phase 1 (Required OS Sandbox): the required OS sandbox these stories execute under.
- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — Scenario Catalog Hermetic Story Coverage Ledger: the coverage ledger this family's 17 mappings extend; the `AUDIT_RECORDS`→`EXECUTABLE_STORY_MAPPINGS` move and the contract-test totals update follow its rules.
- [ADR-0285](0285-hermetic-story-app-local-dependencies.md) — App-Local Story Dependencies (Per-Run Copy/Seal): superseded by the zero-copy bind mount, but part of the hermetic-execution baseline these stories inherit.
- [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — Docker-Only Hermetic Story Execution on All Supported Hosts: the Docker-only execution model these Tier-0 stories run inside on non-sandbox hosts.
- [ADR-0293](0293-settings-story-family.md) — Settings HTTP Story Family — Tier 0 Qualification Coverage for Settings Write Paths: a sibling story-family ADR in this batch; it shares the harness additions (the `given.publicBaseUrl` seam its `/config` scenarios also rely on was introduced alongside this family) and the same ledger-move pattern.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/tools/core-capabilities.ts:15` | `'meta.expand-result': 'expand_result'` entry in `CORE_TOOL_CAPABILITIES`. | `read` confirms. |
| `src/llm-orchestrator-tools.ts:232` | `toolCapabilityCatalog.register('meta.search-tools', 'search_tools')` in `buildFullToolSet`, after `applyCompactionAndDisclosure` (`:224-231`). | `read` confirms. |
| `tests/tools/core-capabilities.test.ts:50-60` | Test `registers the stable core capabilities …` asserts `['meta.expand-result', 'expand_result']` is present in catalog entries. | `read` confirms. |
| `tests/stories/harness/scenario.ts:269` | `ReplyAssertion` type carries `contains(expected): void` alongside `equals`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:432-435` | `replyAssertion.contains` filters captured replies and asserts `toContain(expected)`. | `read` confirms. |
| `tests/stories/harness/scenario.test.ts:347-357` | Contract test `replyTo.contains asserts a substring of the latest reply` (positive, positive, and `toThrow()` negative). | `read` confirms. |
| `tests/stories/harness/scenario.ts:118,512-515` | `given.groupAdmin` in `ScenarioGiven` and impl: `prerequisite` + `world.fixtures.seedGroupAdmin({ groupId: scopedGroupId(group), userId })`. | `read` confirms. |
| `tests/stories/harness/fixtures.ts:272,404-408` | `seedGroupAdmin` delegates to `options.chat.addGroupAdmin(input.groupId, input.userId)`. | `read` confirms. |
| `tests/stories/harness/chat.ts:93,261,305-306` | `groupAdmins = new Set<string>()`, provider `isGroupAdmin(...)`, and `addGroupAdmin(groupId, userId)` seed method. | `read` confirms. |
| `tests/stories/harness/fixtures.test.ts:229-234` | Contract test `given.groupAdmin marks the member as a group admin for command auth`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:242,791-795` | `when.dispatchMessage` dispatches via `world.runtime.dispatch(...)` without `world.settle()` (which `when.message` calls at `:789`). | `read` confirms. |
| `tests/stories/harness/scripted-llm.ts:15,18,71-75` | `ModelDecision` union gains `tool-gate`; `GatedToolCall` type; `gateCall(capabilityId, input)` helper. | `read` confirms. |
| `tests/stories/harness/scripted-llm.ts:293-316` | `doGenerate` detects `tool-gate`, parks the generation on a release/abort-aware promise, registers the abort listener. | `read` confirms. |
| `tests/stories/harness/scripted-llm.ts:325-330` | `nextGate()` resolves the parked gate (or awaits via `gateWaiters`). | `read` confirms. |
| `tests/stories/harness/scripted-llm.ts:331-338` | `verifyConsumed` releases an unreleased gate and throws `'Scripted model gate was never released'` (teardown-leak safety). | `read` confirms. |
| `tests/stories/harness/scripted-llm.test.ts:252-292` | Contract tests: gate parks until released; gate rejects on abort and clears the pending tool call; `verifyConsumed` fails an unreleased gate. | `read` confirms. |
| `tests/stories/harness/scripted-llm.ts:162-201` | `COMPACTION_LATEST` sentinel, `findCompactionHandle`/`latestCompactionHandle`/`resolveCompactionInput`; throws when no compacted tool result was observed. | `read` confirms. |
| `tests/stories/harness/scripted-llm.test.ts:438-478` | Contract tests: resolves `$compaction:latest` from the latest compacted tool result; fails when none was observed. | `read` confirms. |
| `tests/stories/harness/scripted-llm.ts:26,95-103,244` | `promptToolResultTokenFingerprints` inspection (added post-review — see divergence) fingerprints tool-result content separately from text parts. | `read` confirms. |
| `tests/stories/harness/scenario.ts:215,719-722` | `given.publicBaseUrl(url)` fixture (replaces the spec's transient env set/restore — see divergence). | `read` confirms. |
| `tests/stories/harness/fixtures.ts:312,521-527,335-339` | `setPublicBaseUrl` sets/restores `SETTINGS_PUBLIC_BASE_URL`; `teardown` restores it. | `read` confirms. |
| `tests/stories/commands/surface.story.test.ts:23-273` | All 14 command scenarios (help, start, config-dm, config-group, context, clear-self/target-user/all/group-denied, dashboard, stop-noop/graceful/abort, acp). | `read` confirms. |
| `tests/stories/meta/disclosure-and-compaction.story.test.ts:11-81` | All 3 meta scenarios (search-tools, load-tool, expand-result). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:521-608` | The 17 F1 mappings in `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'`, story ids matching the scenario names byte-for-byte. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:1177-1184` | `SCN-cmd-nerv` / `SCN-cmd-announce` remain `blocked` in `AUDIT_RECORDS`. | `read` confirms. |

Plan-vs-implementation notes:

- **`meta.search-tools` is registered unconditionally, not conditionally inside the disclosure path.** The design proposed registering inside `src/tools/disclosure/wire.ts` / `applyCompactionAndDisclosure`, executed only when disclosure actually injects `search_tools`. Shipped (`src/llm-orchestrator-tools.ts:232`) it is one unconditional `catalog.register(...)` in `buildFullToolSet`, because `maybeApplyDisclosure` injects `search_tools` unconditionally — so the conditions are equivalent — and re-registration of the same mapping is idempotent per turn. Capability resolution still fails only when `search_tools` is not advertised, because resolution consults the advertised tool set, not the catalog alone.
- **The oversized-payload trigger is a real `create_task` description, not a `MemoryTaskProvider` knob.** The approved spec deviation: `meta-expand-result` seeds compaction through a >8 000-byte description in the real `create_task` input (`'payload-'.repeat(1200)`), not a dedicated provider knob. More behavioral, one less harness surface; the dropped-knob option is reflected in Considered Option 2.
- **The gate handle is `nextGate(): Promise<{ release }>` rather than `{ reached, release }`.** The design sketched a handle exposing both `reached: Promise<void>` and `release()`. Shipped (`scripted-llm.ts:18,325-330`) the scenario awaits `world.model.nextGate()` for the gate directly — equivalent and simpler, since the await itself is the "reached" signal.
- **Stop-story summaries truthfully count disclosure's `load_tool` and both `create_task` calls.** The plan scripted one `gateCall('tasks.create', …)` and asserted `'🛑 Stopped. Completed 1 action: create_task.'`. Shipped (`surface.story.test.ts:219-223,250-253`) the scenarios seed the full disclosure walk first — `callCapability('tasks.create', …)` (loads + runs), then `gateCall('tasks.create', …)` — so the graceful summary is `'🛑 Stopped. Completed 3 actions: load_tool, create_task ×2.'` and the abort summary is `'… Completed 2 actions: load_tool, create_task. …'`. This is production behavior pinned deliberately (disclosure loads `create_task` through `load_tool`, and both calls complete), not a harness artifact.
- **`/config`-link stories use a `given.publicBaseUrl` fixture, not a transient env set/restore.** The design's post-implementation deviation flagged a transient set/restore of `SETTINGS_PUBLIC_BASE_URL` inside the scenario and asked F4 to introduce a proper `given.*` seam. That seam now exists (`scenario.ts:719-722` / `fixtures.ts:521-527`, restored in `teardown` at `:335-339`), so `SCN-cmd-config-dm` uses `given.publicBaseUrl(SETTINGS_BASE_URL)` and asserts the base URL with `.contains`. The spec's concern is resolved.
- **Group replies are context-keyed.** The plan's `/config-group`, `/clear-group-denied`, and `/dashboard` sketches used `then.replyTo(user)`. Shipped (`surface.story.test.ts:84,89,154,168`) they use `then.replyIn(group)`, because group replies are keyed by context id, not by triggering user. Harness support (`then.replyIn`) was already present.
- **`SCN-cmd-context` pins structural snapshot fragments, not identity.** Seeded identities never surface in the context collector's snapshot, so the scenario asserts `'"modelName":"scenario-main-model"'`, `'"label":"Memory context"'`, and `'"detail":"0 facts"'` via `contains` (`surface.story.test.ts:102-104`) rather than the seeded `providerUserId`. At least one behavioral fragment is asserted, per the spec.
- **`SCN-cmd-clear-all` count is `2`, not `1`.** The plan expected `all 1 users`. Shipped (`surface.story.test.ts:144`) asserts `all 2 users` because `given.admin(bob, { superAdmin: true })` also creates bob's authorized-user row, so the authorized-user count is alice + bob = 2.
- **`SCN-meta-expand-result` uses tool-result token fingerprints, not text fingerprints, and observes 7 generations, not 5.** The plan asserted `_compacted`/`payload` via `promptTokenFingerprints` at `at(-3)`/`at(-1)`. Shipped (`disclosure-and-compaction.story.test.ts:75-80`) it asserts `inspections.length === 7`, `afterList = inspections.at(5)`, and uses `promptToolResultTokenFingerprints` (added post-review at `scripted-llm.ts:95-103`) for both `_compacted` and `payload`, because `promptTokenFingerprints` see text parts only and tool-result content is fingerprinted separately. Turn 2 is 4 generations, not 5, because `expand_result` is a meta tool that is always advertised and needs no `load_tool` hop.
- **`SCN-cmd-acp` uses a runtime extension, not a mirrored group setup.** The plan sketched mirroring `command-prompt.story.test.ts`'s group fixtures. Shipped (`surface.story.test.ts:183-209`) it registers a `given.runtimeExtension` that calls `configureCodingSessionCapability` scoped to alice's DM context id, then exercises the eligible (alice) and disabled (bob, no capability configured) paths through separate DMs — more precise than the sketched group approach and faithful to the command-surface view.

The source plan `docs/superpowers/plans/2026-07-19-f1-command-meta-story-family.md` and design `docs/superpowers/specs/2026-07-19-f1-command-meta-story-family-design.md` are archived alongside this ADR to `docs/archive/`.
