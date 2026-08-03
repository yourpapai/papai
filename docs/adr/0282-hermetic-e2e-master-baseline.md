<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0282: Hermetic E2E Master Baseline — Shared Lifecycle Runtime and Story Harness

## Status

Implemented (with divergence)

## Date

2026-07-12

## Context

papai was entering a parallel architecture-change track (`plugin-core-separation`) with no deterministic mechanism for proving complete user stories across the real application stack. The existing suite had strong focused coverage, process-per-file isolation, an in-memory SQLite snapshot helper, centralized fetch restoration, plugin integration tests, and a Docker-backed Kaneo E2E tier (ADRs 0003/0004/0005/0086), but it could not answer one question reproducibly: *does a normalized chat message still produce the same user-visible outcome — routing, authorization, context resolution, LLM tool-calling, real tool execution, task/plugin operations, persistence, and outgoing reply — before and after a deep internal refactor?*

Two structural blockers made that impossible. First, the production entry point (`src/index.ts`) performed startup as import-time side effects: environment validation, database initialization, plugin activation, schedulers, pollers, web-server binding, and signal registration all ran during module evaluation. There was no composition root a test could construct, fail partway, or shut down. Second, "hermetic" had no enforcement: scenarios could reach ambient credentials, developer services, the public network, wall-clock time, random identifiers, or shared databases, so a green run proved nothing about determinism.

The design (`docs/superpowers/specs/2026-07-12-hermetic-full-stack-e2e-harness-design.md`) and plan (`docs/superpowers/plans/2026-07-12-hermetic-e2e-master-baseline.md`) therefore required **both** halves together: extract a lifecycle-managed composition root shared by production startup and a test harness, and baseline a hermetic full-stack story suite on the *current master* architecture so the unchanged `tests/stories/**` corpus can later qualify the refactor. Hermetic means a scenario's result depends only on declared source fixtures and runner-controlled resources — ambient credentials, network, wall-clock, random IDs, shared databases, and execution order must not affect the outcome.

## Decision Drivers

- **One composition path for production and tests.** Production `src/index.ts` and the harness must build the application through the same `PapaiRuntime`; the harness must not import the side-effectful executable.
- **Lifecycle ownership, not import-time side effects.** Construction must have no externally visible side effects; `start()` owns ordered initialization and is safe to fail partway; `stop()` is idempotent and releases everything it started with partial-startup rollback.
- **Deterministic per-scenario state.** Every scenario gets a fresh database, runtime-owned registries, fixed clock, seeded IDs, scripted model, strict HTTP dispatcher, and event recorder — no leakage between scenarios regardless of order or repetition.
- **Stable behavioral capability identity across an architecture change.** Cross-architecture stories need an identity that survives an intentional wire-namespace change, so tool contributions carry an optional stable `capabilityId` resolved by the assembled runtime rather than a harness-owned alias.
- **Fail immediately on undeclared I/O.** Undeclared network, process, socket, or filesystem activity must fail before reaching a real service, naming the scenario, phase, and attempted operation.
- **Master-first evidence.** The walking skeleton must pass on current master *before* the refactor, so the refactor is judged against a real baseline rather than a suite that only ever passed on the target architecture.
- **A frozen compatibility corpus.** Every file under `tests/stories/**` is hashed into a manifest; the refactor compatibility proof fails before execution if any covered file changed.

## Considered Options

### Option 1 — shared lifecycle-managed composition root + in-process harness with strict boundaries (chosen)

Extract `createPapaiRuntime(config, deps)` used by both production and tests; inject deterministic fakes only at external boundaries (chat ingress, AI SDK model, task provider, HTTP, clock, IDs, filesystem); freeze `tests/stories/**` into a compatibility manifest; add `bun test:stories` as a required CI job with a sanitized environment.

- **Pros:** highest useful fidelity for in-process stories; deterministic scenario-local state and cleanup; stable user-facing DSL across internal refactors; makes production lifecycle ownership explicit; enables strict I/O enforcement and rich diagnostics; produces a reproducible before/after behavioral proof.
- **Cons:** requires deliberate extraction from the side-effectful entry point; exposes singleton caches/registries needing runtime ownership or explicit reset contracts; requires production HTTP clients and time/ID consumers to accept injected boundaries.

### Option 2 — Bun preload and module mocks around the executable

Preload module mocks before imports to prevent original modules from evaluating, giving temporary characterization coverage around the current entry point.

- **Pros:** smallest initial diff; no composition-root extraction.
- **Cons:** scenario correctness depends on import order, module-cache behavior, and an expanding inventory of global resets; architecture refactors break the harness even when user behavior is correct; cannot own lifecycle/cleanup; rejected as the target architecture.

### Option 3 — subprocess or container black-box scenarios as the main tier

Start the real executable for production-entrypoint fidelity.

- **Pros:** exercises the true entry point.
- **Cons:** deterministic clocks, identifiers, per-scenario reset, and failure traces become hard; conflicts with the in-process requirement; too slow for a broad pull-request user-story suite. A small provider-real smoke tier (ADRs 0003/0004) keeps this value separately.

## Decision

The chosen Option 1 landed across the runtime extraction, the capability seam, the harness boundary kit, the typed DSL, the walking-skeleton corpus, the hermetic runner, the frozen manifest, and the required CI job. What shipped:

1. **Runtime cleanup stack** (`src/runtime/lifecycle.ts`). `createRuntimeLifecycle` stores named cleanups with a monotonic registration index; `stop()` sorts by descending priority then descending registration index, attempts every cleanup, and throws one aggregate `Runtime cleanup failed: …` message; `stop()` is idempotent.
2. **Stable tool capability catalog** (`src/runtime/capability-catalog.ts`). `createToolCapabilityCatalog` exposes `register`/`resolve`/`clear`/`entries`; duplicate id→different-wire fails; unknown id fails; a process singleton `toolCapabilityCatalog` is exported.
3. **Shared runtime contract** (`src/runtime/types.ts`). `PapaiRuntimeConfig`, `RuntimeIngress`, `PapaiRuntime` (`start`/`stop`/`dispatch`/`dispatchInteraction`/`request`/`resolveToolCapability`), the grouped `PapaiRuntimeDeps`, `PartialRuntimeDeps`, and `normalizePapaiRuntimeConfig` (all service flags default on for production).
4. **Ordered lifecycle composition** (`src/runtime/create-runtime.ts`). `createPapaiRuntime` guards a `new|starting|started|stopping|stopped` state machine, clears+registers the capability catalog, starts services in the tested order (database → stores → router → ingress → extensions → setupBot → chat start → command menu), registers cleanup immediately after each successful start with the documented `CLEANUP_PRIORITY` constants, honors each optional-service flag independently, rolls back on partial-startup failure, and delegates ingress/request/capability resolution only while started.
5. **Production composition extracted** (`src/runtime/production-deps.ts`, `production-extensions.ts`, `production-background.ts`). `createProductionRuntimeDeps(overrides?)` groups current-master collaborators by dependency group; the production ingress throws `Programmatic ingress is available only when configured`; the extension start/stop pair owns discovery, compatibility evaluation, activation, Kaneo repair, health warnings, and `deactivateAllPlugins()`; overrides merge by group so scenarios can replace boundaries while retaining real extension composition.
6. **`src/index.ts` reduced to an executable shell.** `runProduction` validates required env (`ADMIN_USER_ID`), constructs production config (all three service flags on), starts the runtime, and registers SIGINT/SIGTERM handlers that await `runtime.stop()` before `process.exit(0)`.
7. **Provider-neutral language-model seam.** `LlmOrchestratorDeps.buildOpenAI` was replaced by `buildModel: (config: EffectiveLlmConfig) => LanguageModel`; the default constructs the OpenAI-compatible provider and the orchestrator calls `deps.buildModel(resolvedLlm)`.
8. **Stable capability metadata on tools.** `PluginTool.capabilityId?: string` is registered into the catalog after collision checks; ACP tools carry stable `coding-session.*` ids. Core task tools get an immutable `CORE_TOOL_CAPABILITIES` map and `registerOfferedCoreToolCapabilities` registers only entries whose wire names exist in the real offered tool set (so a context that omits a tool does not advertise that capability for the turn).
9. **Deterministic boundary kit** (`tests/stories/harness/`): `events.ts` (sanitized recorder with monotonic seq/phase), `chat.ts` (normalized in-process chat ingress + reply capture), `strict-http.ts` (exact-match in-memory HTTP dispatcher with `verifyConsumed`), `scripted-llm.ts` (AI SDK `MockLanguageModelV3` script keyed by stable capability ids), `memory-task-provider.ts` (stateful deterministic `TaskProvider` registered through the real contributed-provider registry), `fixtures.ts` (database/instance/user/context/settings seeds reusing production stores), and `fake-magi.ts` (deterministic magi contract for the real ACP plugin).
10. **Fresh `ScenarioWorld` and typed DSL** (`tests/stories/harness/world.ts`, `scenario.ts`). `createScenarioWorld(name)` builds events, a fixed clock (`2026-01-01T00:00:00.000Z`), seeded IDs, strict HTTP, scenario chat, scripted model, memory provider, a fresh DB, and a `PapaiRuntime` with all background/network/announcement flags false but real plugin discovery/activation and real bot/settings/tool wiring; `scenario(name, run)` wraps a Bun test, runs `world.verify()`, and stops in `finally`.
11. **Walking-skeleton stories** under `tests/stories/{chat-task,context,settings,integrations}/`: chat-to-task create/read, group-users identity/settings sharing, thread-scope config-shared/history-isolated, guest read-only, real settings-route task-instance assignment observed by a later chat turn, real ACP coding-session start against fake magi, and plugin eligibility.
12. **Hermetic runner and I/O guard** (`scripts/story/test-stories.ts`, `tests/stories/preload.ts`, `tests/stories/harness/io-guard.ts`). The launcher spawns `bun --no-env-file test` with `--preload tests/stories/preload.ts`, inherits only `PATH`/`HOME`/`TMPDIR`/`CI`, fixes `TZ=UTC`, and sets `PAPAI_STORY_RUNNER=1`; the preload installs deny-by-default guards around global fetch, process APIs, child-process/socket exports, and filesystem writes outside the scenario temp root, restored in `afterAll`.
13. **Frozen manifest and compatibility check** (`scripts/story/manifest.ts`, `scripts/story/baseline.ts`). A Zod-validated manifest records version, commit, Bun version, seed, harness tree hash, per-file SHA-256, and scenario checkpoints; `test:stories:compat` requires an explicit `BASE_REF`/`--baseline-ref` and fails before child spawn when any covered file differs.
14. **Required CI job** (`.github/workflows/ci.yml` `stories`): runs after build, executes the process-boundary proof, the hermetic contracts, and `bun test:stories:coverage`, uploads `reports/stories/**` on `always()`, and configures no retries. A nightly `story-stress.yml` runs `test:stories:stress` (`--rerun-each 10 --randomize`).

## Consequences

### Positive

- Production startup gained explicit lifecycle ownership: `src/index.ts` is a thin, testable shell and partial-startup failure unwinds cleanly instead of leaving half-bound listeners.
- The refactor track received a reproducible before/after behavioral proof: the same `tests/stories/**` bytes run through master composition and (later) through refactored composition, with a frozen manifest gate.
- External integrations — including the real ACP plugin against fake magi — are testable deeply without network flakiness, service cost, or developer credentials.
- Fresh per-scenario state prevents settings, context, capability-catalog, plugin-activation, and event leakage; scenarios pass in any order and under repetition.
- Stable capability ids decouple cross-architecture stories from wire namespaces, so an intentional tool rename is a focused-contract concern, not a story rewrite.
- Failure traces carry scenario name, phase, attempted operation, and recent sanitized cross-component events without broad snapshots that couple stories to implementation structure.

### Negative

- Extracting the composition root was meaningful architecture work before broad story coverage could land; some existing globals, caches, and direct environment/time/I/O reads needed seams or ownership changes.
- In-memory service fakes (memory task provider, fake magi, fake MCP server) require maintenance alongside the real adapters, and a provider-real smoke tier (ADRs 0003/0004/0008) still has value for deployment compatibility.
- The JS-monkey-patch I/O guard is process-level JavaScript enforcement, not OS-level isolation — a limitation this baseline acknowledged and a later decision (ADR-0225) closed with a kernel-enforced Docker sandbox.
- Compatibility-mode strictness is a deliberate brake on the refactor: the candidate cannot rewrite behaviorally unchanged scenarios, so an intentional behavior change requires explicit product review outside the frozen corpus.

### Risks

- **Fake drift.** Each fake transport must track the real adapter; mitigated by focused real-adapter contract tests and the small provider-real tier.
- **Capability mapping hides regressions.** Mitigated by resolving each stable id from the real assembled contribution metadata, verifying the resolved wire name is present in the offered tool set per turn, and keeping concrete tool-name assertions in focused contract tests.
- **Candidate edits the tests.** Mitigated by hashing the entire frozen corpus and failing the compatibility job before execution on any diff.
- **Harness becomes a second application.** The harness composes and observes real components but must not duplicate authorization, context, tool, plugin, or trusted-module logic; the per-scenario proving-tier catalog (added beyond this plan) keeps coverage honest about which tier proves what.
- **False hermeticity confidence.** The JS guard alone is bypassable at the native/runtime level; this baseline documented that limitation, which ADR-0225 then closed structurally.

## Related Decisions

- **ADR-0003 / ADR-0004 / ADR-0005** — Docker Compose E2E harness and Kaneo coverage/remediation (Tier 1 provider-real lane). This baseline explicitly does **not** replace that tier; it adds the in-process Tier 0 lane alongside it.
- **ADR-0050** — E2E Planning Workflow with Realism Tiers; the tier model this decision slots into as the hermetic in-process tier.
- **ADR-0054** — Guardrail-First Mock Isolation for Bun Tests; the JS-guard lineage whose diagnostics role survives here (and which ADR-0225 demotes further).
- **ADR-0086** — Kaneo Compatibility Gap, Tier 1 E2E Coverage Extension; the provider-real coverage this harness complements.
- **ADR-0225** — Hermetic Story Execution — Docker-Only OS Sandbox with Immutable Snapshots; supersedes this baseline's JS-guard hermeticity with kernel enforcement, extends the manifest (v4, runtime-inputs + dependency + backend hashes), and demotes the JS guard to diagnostics. This ADR records the baseline as established; ADR-0225 records its hardening.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/runtime/capability-catalog.ts:13-36` | `createToolCapabilityCatalog` (`register`/`resolve`/`clear`/`entries`); duplicate-id and unknown-id failures; exported singleton `toolCapabilityCatalog`. | `read` confirms. |
| `src/runtime/lifecycle.ts:11-20` | `RuntimeLifecycle` interface + `CLEANUP_PRIORITY`-style ordering helper (`inCleanupOrder` sorts descending priority then descending registration index). | `read` confirms. |
| `src/runtime/lifecycle.ts:35-74` | `runCleanups` aggregates failures into `Runtime cleanup failed: …`; `createRuntimeLifecycle` makes `stop()` idempotent via `stopInFlight`. | `read` confirms. |
| `src/runtime/types.ts:10-31` | `PapaiRuntimeConfig` (admin/plugin-dir + three service flags) and `normalizePapaiRuntimeConfig` (flags default on). | `read` confirms. |
| `src/runtime/types.ts:38-70` | `PapaiRuntime` contract (`start`/`stop`/`dispatch`/`dispatchInteraction`/`request`/`resolveToolCapability`), grouped `PapaiRuntimeDeps`, `PartialRuntimeDeps`. | `read` confirms. |
| `src/runtime/create-runtime.ts:11-20` | `CLEANUP_PRIORITY` constants (clearIngress 100 … database 0) match the plan. | `read` confirms. |
| `src/runtime/create-runtime.ts:39-102` | Ordered startup (capabilities.clear → database → stores → router+ingress → extensions → setupBot → chat start → command menu) then optional services. | `read` confirms. |
| `src/runtime/create-runtime.ts:104-131,182-208` | Partial-startup rollback (`rollbackStartup`) and `createPapaiRuntime` state machine; ingress/request/capability gated on `started`. | `read` confirms. |
| `src/runtime/production-deps.ts:35-41` | Imports `toolCapabilityCatalog`, `startProductionExtensions`, `ProductionBackgroundHandle`; `INGRESS_ERROR = 'Programmatic ingress is available only when configured'`. | `read` confirms. |
| `src/runtime/production-deps.ts:48+` | `startDatabase`/`initDb`/bootstrap moved from the old entry point into production deps; extension start/stop owns plugin lifecycle. | `read` confirms. |
| `src/runtime/production-extensions.ts`, `src/runtime/production-background.ts` | Focused collaborators split out of the monolithic production deps (extensions discovery/activation/deactivation; background schedulers/pollers). | `glob` confirms. |
| `src/index.ts:90-115` | `runProduction`: validates `ADMIN_USER_ID`, builds `productionConfig`, `deps.createRuntime(...)`, `runtime.start()`, `registerShutdownHandlers` (SIGINT/SIGTERM → `runtime.stop()` → `exit(0)`). `import.meta.main` guard. | `read` confirms. |
| `src/llm-orchestrator-types.ts:23` | `buildModel: (config: EffectiveLlmConfig) => LanguageModel` replaces the OpenAI-specific factory. | `grep` confirms. |
| `src/llm-orchestrator.ts:45,115` | Default `buildModel` constructs the OpenAI-compatible provider; `callLlm` calls `deps.buildModel(resolvedLlm)`. | `grep` confirms. |
| `src/plugins/runtime-types.ts:95` | `capabilityId?: string` on `PluginTool`. | `grep` confirms. |
| `src/plugins/contributions.ts:205-206` | After collision checks, `capabilityCatalog.register(pluginTool.capabilityId, namespacedName)`. | `grep` confirms. |
| `src/tools/core-capabilities.ts:10-98` | Immutable `CORE_TOOL_CAPABILITIES` map (tasks.create/get/list/search + dozens more stable ids). | `read` confirms. |
| `src/tools/core-capabilities.ts:100-104` | `registerOfferedCoreToolCapabilities` registers only entries whose wire name exists in the offered tool set. | `read` confirms. |
| `tests/stories/harness/world.ts:36-37,19-22` | `FIXED_NOW = '2026-01-01T00:00:00.000Z'`; `createPapaiRuntime` + `createProductionRuntimeDeps` consumed by the world. | `read` confirms. |
| `tests/stories/harness/scenario.ts:6` | `scenario()` wraps a Bun `test`, constructs the world, runs the API, verifies, and stops in `finally`. | `read` confirms. |
| `tests/stories/harness/{events,chat,strict-http,scripted-llm,memory-task-provider,fixtures}.ts` | Deterministic boundary kit (event recorder, normalized chat ingress/reply capture, exact-match HTTP dispatcher, scripted `MockLanguageModelV3`, memory task provider, DB/instance fixtures). | `glob` confirms. |
| `tests/stories/harness/fake-magi.ts` | Deterministic magi contract for the real ACP plugin (Task 13). | `glob` confirms. |
| `tests/stories/preload.ts:10-15` | Rejects unless `PAPAI_STORY_RUNNER=1`; `installIoGuard()` then `afterAll(restoreIoGuard)`. | `read` confirms. |
| `tests/stories/harness/io-guard.ts` (and `io-guard-timers.ts`, `io-guard-filesystem.ts`, `io-guard-probe.ts`) | JS deny-by-default guards for fetch/process/socket/fs (later demoted to diagnostics by ADR-0225). | `glob` confirms. |
| `tests/stories/chat-task/create-and-read-task.story.test.ts` | DM create/read task story. | `glob` confirms. |
| `tests/stories/context/{group-users,thread-scope,guest-readonly}.story.test.ts` | Identity/settings sharing, thread-isolated history, guest read-only stories. | `glob` confirms. |
| `tests/stories/settings/task-instance-assignment.story.test.ts` | Real settings route changes provider assignment; next chat turn observes it. | `glob` confirms. |
| `tests/stories/integrations/coding-sessions/start-session.story.test.ts`, `tests/stories/integrations/plugins/eligibility.story.test.ts` | Real ACP-against-fake-magi story and plugin eligibility story. | `glob` confirms. |
| `scripts/story/test-stories.ts` | Sanitized-env story launcher (plan named `scripts/test-stories.ts`). | `glob` confirms. |
| `scripts/story/manifest.ts:68,185` | `StoryManifestSchema` `version: z.literal(4)`; `buildStoryManifest` emits `version: 4` (plan spec declared `version: 1`). | `read` confirms. |
| `scripts/story/manifest.ts:72-77,117` | Harness tree hash + per-file SHA-256 + scenario checkpoints; `hashTree` namespace. | `read` confirms. |
| `scripts/story/baseline.ts`, `scripts/story/snapshot.ts`, `scripts/story/sandbox.ts` | Baseline-ref comparison, immutable session snapshot, Docker sandbox backend selection (hardening beyond this plan; see ADR-0225). | `glob` confirms. |
| `.github/workflows/ci.yml:105-146` | `stories` job (`needs: build`): Docker/sandbox preflight, `process-boundary.test.ts` under `PAPAI_REQUIRE_STORY_SANDBOX=1`, `test:stories:contracts` (JUnit), `test:stories:coverage`, upload `reports/stories/**` on `always()`. | `read` confirms. |
| `.github/workflows/story-stress.yml:53-56` | Nightly `test:stories:stress` (`--rerun-each 10 --randomize`), no retries. | `grep` confirms. |
| `package.json` scripts | `test:stories`, `test:stories:stress`, `test:stories:manifest`, `test:stories:compat`, `test:stories:contracts`, `test:stories:coverage`, `test:stories:sandbox`. | `grep` confirms. |
| `tests/stories/catalog/coverage.ts` | Per-scenario proving-tier catalog gating which tier may prove each behavior (added beyond this plan). | `glob` confirms. |

Plan-vs-implementation notes:

- **Scripts reorganized into a `scripts/story/` module.** The plan named flat files `scripts/test-stories.ts` and `scripts/story-manifest.ts`. Shipped consolidates the entire runner into a `scripts/story/` package (`test-stories.ts`, `manifest.ts`, `baseline.ts`, `snapshot.ts`, `sandbox.ts`, `session.ts`, `dependencies*.ts`, `coverage-gate.ts`, `cli.ts`, …). Intent (sanitized env, manifest, baseline comparison) is preserved; the manifest reference moved from `scripts/story-manifest.ts` to `scripts/story/manifest.ts`.
- **The manifest evolved to version 4 with split hashes.** The plan's design spec declared a single version-1 schema hashing only `tests/stories/**`. Shipped (`scripts/story/manifest.ts:68`) records separate tree hashes for the harness, runtime inputs (`src/`/`plugins/`/package metadata), the dependency closure, and the sandbox backend, plus `kind: file|symlink` entries. This is concurrent hardening captured by ADR-0225, not a deviation in intent.
- **Hermeticity enforcement was superseded by a kernel-enforced Docker sandbox.** The plan's JS-monkey-patch I/O guard (Task 14) shipped (`tests/stories/preload.ts` + `tests/stories/harness/io-guard*.ts`) but ADR-0225 later demoted it to diagnostics after confirmed native-loader/glob/symlink bypasses; hard hermeticity is now proven by `tests/stories/sandbox/process-boundary.test.ts` inside a digest-pinned, networkless Docker container, and CI requires `PAPAI_REQUIRE_STORY_SANDBOX=1`. This ADR records the baseline as the plan established it; ADR-0225 records the structural fix.
- **The compatibility corpus broadened beyond `tests/stories/**`.** The plan froze only story files; shipped also freezes `scripts/story/**` plus several shared support files (`bunfig.toml`, `tests/setup.ts`, `tests/mock-reset.ts`, select `tests/utils/*` and `scripts/coverage/*`), and captures runtime inputs into an immutable per-run snapshot so worktree mutation cannot change which bytes execute (ADR-0225).
- **The harness and story corpus grew far beyond the walking skeleton.** The plan's eight stories shipped, but the tree now also covers memory/instructions, commands, scheduling (recurring/deferred), web-fetch, HTTP (dashboard/transcript-viewer/auth-claim/notify), interactions (permission-decision), tasks subareas (lifecycle/policy/provider-surface/integration-surface), MCP integrations (admin-catalog/plugin-servers/plugin-route), coding-session variants (acp-controls/acp-mcp/module-qualification/acp-lifecycle), and settings variants — plus a `tests/stories/catalog/coverage.ts` per-scenario proving-tier system and a `tests/stories/harness/parity/` subpackage.
- **`production-deps.ts` was split, not monolithic.** The plan envisioned a single `production-deps.ts`; shipped factors extension composition into `production-extensions.ts` and background services into `production-background.ts`, with `production-deps.ts` orchestrating the groups. Behavior is unchanged; the split keeps `create-runtime.ts` free of feature/plugin imports as the plan required.
- **CI runs the coverage-gated story lane plus a separate contracts lane.** The plan named `bun test:stories` + `bun test:stories:stress`. Shipped runs `test:stories:contracts` and `test:stories:coverage` (line-coverage floor in `scripts/story/coverage-floor.json`) in the `stories` job, with the randomized stress lane in nightly `story-stress.yml`. The Docker Kaneo tier (ADRs 0003/0004) remains and is not replaced.
- **The `buildModel` seam pattern propagated.** After landing in the chat orchestrator (Task 2), the same provider-neutral `buildModel` DI shape was adopted by the announcement, web-distill, conversation, proactive, and long-term-memory runners — broader than the plan's two-file scope but the same idiom.

The source plan `docs/superpowers/plans/2026-07-12-hermetic-e2e-master-baseline.md` and design `docs/superpowers/specs/2026-07-12-hermetic-full-stack-e2e-harness-design.md` are archived alongside this ADR to `docs/archive/`.
