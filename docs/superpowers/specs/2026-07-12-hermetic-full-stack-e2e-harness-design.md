<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Hermetic full-stack user-story E2E harness

**Status:** approved direction, revised for master-to-refactor proof, pending final review

**Date:** 2026-07-12

## Context

papai is undergoing a parallel global refactoring and architecture-change track. The
existing test suite has strong focused coverage, process-per-file isolation, an
in-memory SQLite snapshot helper, centralized fetch restoration, plugin integration
tests, and a Docker-backed Kaneo E2E tier. It does not provide one deterministic
mechanism for proving complete user stories across the real application stack.

The required regression safety net starts with a normalized chat message and follows
the real path through routing, authorization, context resolution, LLM tool-calling,
tool execution, task or plugin operations, persistence, and the outgoing reply. It
must also exercise settings, multi-user and multi-thread context behavior, plugin
activation, and integrations such as ACP. It must be fast and deterministic enough
to run as a required pull-request check while production architecture is changing.

The harness must land and prove these stories on the current master architecture
first. The `plugin-core-separation` refactor must then run the same scenario sources
and assertions unchanged. This before/after use is central: the harness is not merely
designed for the target architecture; it establishes the behavioral baseline against
which that architecture is judged.

Hermetic means that a scenario's result depends only on declared source fixtures and
runner-controlled resources. Ambient credentials, developer services, the public
network, wall-clock time, random identifiers, shared databases, and execution order
must not affect the outcome.

## Goals

1. Drive real full-stack user stories in-process: chat message in, scripted LLM
   tool-calling, real tool execution, durable effects, and reply out.
2. Use the same application composition path as production while replacing only
   external boundaries with deterministic fakes.
3. Give every scenario a fresh application world, including database, runtime state,
   providers, extensions, clock, identifiers, and event history.
4. Fail immediately on undeclared network, process, socket, or filesystem activity.
5. Provide a small typed TypeScript DSL that expresses user intent and observable
   outcomes rather than internal implementation details.
6. Support real extensions and provider adapters against in-memory fake transports,
   including the current ACP plugin against a fake magi service.
7. Produce actionable traces and leak reports when a story fails.
8. Remain useful as internal modules are refactored by keeping scenario inputs and
   assertions at stable behavioral boundaries.
9. Establish passing evidence on current master, then rerun the byte-identical
   behavioral scenario corpus after `plugin-core-separation`.

## Non-goals

- Replacing focused unit, component, adapter-contract, mutation, or security tests.
- Exercising public chat networks or live LLM, task-provider, magi, or other external
  services in the main user-story suite.
- Validating Docker packaging or real Kaneo deployment compatibility. A small
  provider-real tier may remain for that purpose.
- Testing provider-specific Telegram, Mattermost, Discord, or Kontur Talk wire-event
  parsing in every user story. The harness begins with normalized `IncomingMessage`
  values; wire adapters retain focused contract tests.
- Adding a nerv plugin. Nerv is a future consumer from another branch and must fit the
  generic real-extension/fake-transport boundary.
- Defining a YAML or JSON scenario language.
- Making the initial master implementation depend on trusted-module APIs that do not
  exist on master yet.

## Decision

Extract a lifecycle-managed papai composition root used by both production startup
and the test harness. Build a typed scenario DSL on top of that shared runtime. The
harness injects deterministic implementations at external boundaries while running
real routing, bot handling, settings routes, persistence, LLM orchestration, tool
assembly and execution, task-provider resolution, context rules, and extension
lifecycle code.

Implement and baseline this runtime on current master, using its existing plugin
lifecycle. The public runtime and scenario contracts are extension-neutral: they do
not expose plugin paths, trusted-module registries, or wire-level tool namespaces.
When `plugin-core-separation` introduces trusted modules, production composition adds
that lifecycle behind the same runtime contract. The complete `tests/stories/**`
tree remains unchanged for the compatibility proof.

Production `src/index.ts` becomes a thin executable adapter around the shared
composition root: validate environment, create the runtime with production
dependencies, start it, and install signal handlers.

The harness must not import `src/index.ts`. Importing the current executable would
trigger environment validation, database initialization, plugin activation,
schedulers, pollers, web-server startup, and signal registration as module side
effects. Both entry points instead consume the shared composition API.

## Approaches considered

### A. Shared lifecycle-managed composition root (chosen)

Extract runtime assembly and inject external boundaries. Production and scenarios
share the same construction path.

Advantages:

- highest useful fidelity for in-process stories;
- deterministic scenario-local state and cleanup;
- stable user-facing DSL across internal refactors;
- makes production lifecycle ownership explicit;
- enables strict I/O enforcement and rich diagnostics.

Costs:

- requires deliberate extraction from the side-effectful current entry point;
- exposes singleton caches and registries that need runtime ownership or explicit
  reset contracts;
- requires production HTTP clients and time/ID consumers to accept boundaries.

### B. Bun preload and module mocks around the executable (rejected as the target)

Bun can preload module mocks before imports, preventing some original modules from
being evaluated. This could provide temporary characterization coverage during the
composition-root extraction.

It is not the target architecture because scenario correctness would depend on
import order, module-cache behavior, and an expanding inventory of global resets.
Architecture refactors would break the harness even when user behavior remained
correct.

### C. Subprocess or container black-box scenarios (rejected as the main tier)

Starting the real executable offers production-entrypoint fidelity, but deterministic
clocks, identifiers, cleanup, per-scenario reset, and failure traces become harder.
It also conflicts with the in-process requirement and would be too slow for a broad
pull-request user-story suite. A very small smoke tier may use this approach later.

## Master-to-refactor proof contract

The harness is delivered to current master before it is used to qualify
`plugin-core-separation`. The proof has two runs:

1. **Baseline:** current master runs the walking-skeleton scenario corpus using the
   current production composition, including the ACP plugin.
2. **Candidate:** the refactor branch is rebased or merged onto that baseline and runs
   the same corpus through the refactored production composition, where coding-session
   behavior may come from a trusted module instead.

The compatibility proof requires no changes anywhere under `tests/stories/**`
between the baseline and candidate commits. The DSL, scenario inputs, scripted LLM
decisions, fixtures, assertions, capability resolver, and strict boundary guards are
all byte-identical. A candidate may change production code and the shared production
runtime implementation outside that directory, but it must not add a refactor-only
harness adapter or relax an assertion to pass.

The required CI proof records:

- baseline and candidate commit SHAs;
- Bun version and deterministic seed;
- a manifest of scenario IDs plus hashes of every file under `tests/stories/**`;
- pass/fail and named behavioral checkpoints for each scenario.

A compatibility job compares the complete harness manifest to the selected baseline
and fails before running if any covered file changed. Normal feature development may
add new stories after the refactor compatibility proof; those additions are reviewed
separately and are not retroactively counted as proof for the refactor.

Passing both runs proves that the declared stories still produce the expected user
outcomes. It does not require byte-identical internal traces: tool namespaces,
registry events, and implementation call paths may intentionally change. Focused
architecture and tool-surface tests cover those internal contracts.

## Runtime architecture

The shared composition root exposes a lifecycle rather than executing work during
module import:

```typescript
interface PapaiRuntime {
  start(): Promise<void>
  stop(): Promise<void>
  dispatch(message: IncomingMessage): Promise<void>
  request(request: Request): Promise<Response>
  resolveToolCapability(capabilityId: string): string
}
```

The runtime contract must preserve five properties:

1. construction has no externally visible startup side effects;
2. `start()` owns initialization and is safe to fail partway through;
3. `stop()` is idempotent and releases everything the runtime started;
4. normalized chat dispatch and fetch-style HTTP routing are available without a
   network listener;
5. stable tool capabilities resolve to the wire name contributed by the active
   architecture after startup.

`createPapaiRuntime(config, deps)` assembles the real application:

- SQLite initialization and configuration stores;
- platform and task-instance resolution;
- `ChatRouter` and `setupBot`;
- LLM orchestration and tool execution;
- settings, admin, debug, and extension HTTP route dispatch;
- the production extension phases for the checked-out architecture;
- on current master: plugin discovery, approval, compatibility evaluation,
  activation, and deactivation;
- optional schedulers, pollers, sweepers, announcements, and network listeners.

Background services default off in scenarios. A scenario testing one enables it
explicitly and drives it through the virtual clock.

The scenario runtime receives a boundary kit:

```typescript
interface ScenarioBoundaryKit {
  chat: ScenarioChatAdapter
  llm: ScriptedLanguageModel
  tasks: ScenarioTaskProviderRegistry
  http: StrictFetchDispatcher
  clock: ScenarioClock
  ids: ScenarioIdSource
  files: ScenarioFileSystem
}
```

The composition root owns the lifecycle of every extension phase it starts. Current
master already has plugin activation and deactivation. A later trusted-module phase
must provide equivalent symmetric teardown: either runtime-scoped ports/registries or
activation disposers invoked by `PapaiRuntime.stop()` in reverse order. Registering a
port, listener, or subscriber without a corresponding cleanup operation is
incompatible with fresh per-scenario worlds.

The composition root should own mutable runtime services rather than relying on
process-global state. Existing unavoidable registries and caches must have explicit
scenario reset/leak contracts until they can become runtime-owned. The refactor may
change those internals, but it preserves the `PapaiRuntime` contract established on
master.

### Stable behavioral capability identity

Cross-architecture tool scenarios need an identity that survives an intentional wire
namespace change. Current master therefore adds an optional stable behavioral
capability id to real tool contribution metadata, for example
`coding-session.start`. The assembled runtime exposes a read-only catalog mapping a
capability id to the wire-level tool contributed by the active architecture.

The capability id is production contribution metadata, not a harness-owned alias.
The current ACP plugin declares it on master; the trusted coding module preserves the
same id after refactoring. Registration fails on duplicate ids, and scenario
resolution fails on missing capabilities. The scripted model additionally verifies
that the resolved wire name is present in the real tool set offered for that specific
turn, catching context eligibility and permission filtering. Concrete tool names
remain covered by focused tool-surface and preference-migration tests.

## Scenario world and typed DSL

Each test creates a fresh `ScenarioWorld`. Scenarios are ordinary Bun TypeScript tests
with a small fluent API:

```typescript
scenario('group member creates a task', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const team = given.group('delivery', { members: [alice] })

  given.taskProvider('tracker', { type: 'memory' })
  given.assignTaskProvider(team, 'tracker')
  given.llm.script([callTool('create_task', { title: 'Release 7' }), answer('Created “Release 7”.')])

  await when.message(alice, team, 'Create task Release 7')

  then.reply.to(alice).equals('Created “Release 7”.')
  then.task('Release 7').exists()
  then.context(team).historyContains('Create task Release 7')
})
```

The API is divided by intent:

- `given` seeds users, groups, threads, roles, settings, instances, credentials,
  extension approvals/configuration, task state, and scripted LLM turns.
- `when` delivers chat messages/interactions, calls real settings routes using
  authenticated `Request` objects, advances the clock, or emits declared integration
  callbacks.
- `then` asserts replies, task state, context/history, permissions, settings,
  extension records, and emitted integration requests.
- `world.inspect` is an escape hatch for diagnostics and uncommon assertions, not the
  normal authoring surface.

Cross-architecture stories name stable behavioral capabilities rather than extension
mechanisms. For example, a coding-session story refers to `coding-session.start`, not
`plugin_acp__start_session`, `module_coding__start_session`, an ACP file path, or a
registry type. The harness resolves the capability through the real runtime catalog
and fails if it is absent, duplicated, or ineligible for the scenario context. Plugin
lifecycle stories may still name a specific plugin because plugin behavior itself is
their subject.

Scenario fixtures return opaque typed handles rather than exposing database primary
keys. Settings stories must call real settings routes when the route workflow is the
behavior under test; direct seeding is reserved for prerequisites.

Assertions target user-visible replies and durable invariants. Broad snapshots of
prompts, database contents, and event logs are prohibited because they couple stories
to implementation structure. Internal traces remain available for focused contract
assertions and failure diagnostics.

## Scripted LLM

The scripted model uses the AI SDK's supported `MockLanguageModelV3` contract. It
returns deterministic text and tool-call steps while papai continues to run its real
multi-step orchestration, tool-schema validation, permission gating, execution, tool
result handling, and reply construction.

Scripts may match declared behavioral inputs such as the latest user message,
available tool names, or previous tool results. A script must not mutate papai state
directly. All effects pass through real tools and providers.

Script helpers accept stable capability references and emit the actual wire-level tool
name returned by the production runtime catalog. This keeps user stories unchanged
across an intentional namespace migration while still detecting a missing
contribution. A separate focused tool-surface contract asserts concrete names and
migration behavior; the user-story harness must not silently declare any similarly
named tool equivalent.

At scenario end the model reports:

- unconsumed scripted steps;
- unexpected invocations;
- available-tool mismatches;
- clipped prompt and tool-result context needed to diagnose the mismatch.

Generated IDs in model responses use the scenario ID source so repeated runs produce
the same trace.

## External boundaries and fidelity levels

The scenario syntax does not change when an integration moves between two fidelity
levels.

### Contract fake

An in-memory implementation of a production interface. Most cross-feature user
stories use this level because it is fast and isolates papai orchestration behavior.
Examples include the normalized chat adapter and a generic memory task provider.

### Real extension or adapter with fake transport

The real plugin, trusted feature module, or provider implementation runs, but its
outbound HTTP calls route to a deterministic in-memory service registered with
`StrictFetchDispatcher`. This level verifies request serialization, authentication,
response mapping, contribution registration, and errors without a live service.

Kaneo and YouTrack compatibility stories activate their real task-provider plugins
against fake HTTP APIs. On the master baseline, coding-session stories activate the
real ACP plugin against a fake magi service. On `plugin-core-separation`, the same
stories load the real coding trusted module against that same fake magi contract.
Future integrations, including nerv plugins, use the same pattern.

The fake magi service supports only endpoints required by declared stories and records
requests. It must cover session start, continuation, approval, cancellation,
completion, listing/status, failures, and notification-related flows as those stories
are added. Coding-session stories use real credential resolution, guardrails, group
identity, durable history, eligibility, and tool registration in both architectures.

## Data flow

```text
scenario user
  -> in-process chat adapter
  -> real ChatRouter and bot
  -> real LLM orchestration
  -> scripted AI SDK model
  -> real tool assembly, permission gates, and execution
  -> real core service or extension/provider adapter
  -> declared in-memory external service
  -> fresh in-memory SQLite durable state
  -> outgoing reply captured by the chat adapter

scenario settings request
  -> real settings authentication and route dispatch
  -> fresh in-memory SQLite durable state
  -> next chat turn observes the changed configuration
```

Multi-user context scenarios use this same path to verify thread-isolated live state,
group-shared durable configuration, per-user identity/quota state, guest permissions,
and mid-run steering.

## Hermetic execution and lifecycle

`bun test:stories` launches the suite with a sanitized environment. It retains only a
documented minimal allowlist needed by the runtime and fixes `TZ=UTC`. Developer
credentials, provider URLs, and local `.env` values are not inherited. Scenario
configuration is passed as typed values rather than ambient environment variables.

Each scenario performs this lifecycle:

1. create a unique temporary root;
2. restore the once-migrated SQLite snapshot into a new in-memory database;
3. create fresh runtime-owned registries, caches, providers, and event collectors;
4. install the fixed clock, seeded IDs, scripted model, and strict I/O guards;
5. seed declared prerequisite state;
6. start the real runtime and execute the story;
7. stop the runtime in `finally`;
8. verify that no pending model steps, requests, timers, listeners, servers,
   extension activations, port registrations, environment mutations, or filesystem
   artifacts escaped cleanup.

`stop()` and leak validation run even after setup, execution, or assertion failure.
Partial startup failure must still unwind already-started components.

## Strict I/O enforcement

Hermeticity is enforced in layers:

- Production HTTP clients receive `StrictFetchDispatcher` through the composition
  root. Requests succeed only when a scenario registered an exact handler.
- A global fetch guard catches code that bypasses injection and rejects it with the
  attempted method and URL.
- Test preloads reject direct socket creation and child-process execution.
- Filesystem writes are restricted to the scenario's unique temporary root. Declared
  repository fixtures are read-only.
- The launch command sanitizes environment inputs and after-test validation detects
  environment mutation.
- Time-sensitive application components receive `ScenarioClock`. Bun's mocked system
  time controls `Date` but not timers, so scheduler behavior must use an injected
  timer/clock abstraction.
- Random bytes, nonces, IDs, and unique suffixes that affect behavior come from a
  seeded scenario source.

The JavaScript-level guards protect normal papai code paths. Native code and runtime
bugs are outside this harness's enforcement boundary; the harness must not claim an
OS-level sandbox guarantee. CI may add a Linux network namespace as defense in depth,
but scenario correctness cannot depend on that platform-specific wrapper.

Narrow opt-ins are possible only through declared boundaries. For example, a story
testing file attachments may allocate files below its scenario root. A route-listener
story may request an ephemeral loopback listener, but ordinary settings stories call
the fetch-style route dispatcher without binding a port.

## Failure diagnostics

Unexpected operations fail immediately with:

- scenario name and current `given`/`when`/`then` or teardown phase;
- attempted URL, path, command, socket, timer, or environment change;
- registered boundaries and closest matching request handlers;
- recent chat, LLM, tool, provider, extension, and settings events.

After-test leak validation reports all remaining resources together. When a primary
assertion also failed, the leak report is attached rather than replacing it. Traces
clip sensitive and oversized values and must never include credentials or bearer
tokens.

No retries are allowed in the required CI job. A retry can be a local diagnostic tool
but cannot turn a flaky scenario green.

## Suite organization

```text
tests/stories/
  harness/
    runtime.ts
    scenario.ts
    boundaries/
    fixtures/
    assertions/
    diagnostics/
  chat-task/
  settings/
  context/
  integrations/
    coding-sessions/
    plugins/
  regression/
```

Scenarios carry typed metadata such as behavioral area, required capabilities,
extensions, and issue reference. Metadata supports selection and deterministic CI
sharding; it must not introduce behavior branches inside a story.

The master-to-refactor compatibility manifest covers all of `tests/stories/**`, not
only scenario files. Production runtime code is versioned normally, but the candidate
proof fails if the refactor changes any harness, fixture, script, boundary, or
assertion file.

## Initial walking skeleton

The first implementation is complete when these stories pass through the shared
runtime:

1. A DM user creates and reads a task through scripted LLM tool calls.
2. Two users in a group observe shared settings and isolated identity.
3. Two threads in one group share durable configuration while retaining separate
   conversation histories.
4. A guest can read but cannot execute a mutating task tool.
5. A real settings request changes provider or plugin configuration, and the next chat
   turn observes it.
6. A coding session starts through the current real ACP plugin and fake magi
   transport; the identical story later passes through the trusted coding module.
7. A disabled or incompatible plugin contributes no tools.
8. Undeclared network access and leaked runtime state produce actionable failures.

These stories intentionally span the main architectural seams. More scenarios are
added based on user-story risk and regressions, not to duplicate every unit-test case.

## CI strategy

- Add `bun test:stories` as a required pull-request job.
- Add a compatibility mode that accepts an explicit baseline commit and verifies the
  complete `tests/stories/**` manifest is unchanged before execution.
- Use deterministic sharding by scenario file for the normal PR path.
- Report scenario metadata, manifest hash, baseline/candidate SHAs, and the
  deterministic seed in test output.
- Run a scheduled or pre-merge stress job with randomized order and repeated
  execution to reveal order dependence.
- Do not retry failures in required checks.
- Keep traces concise on success and attach the full sanitized trace only on failure.

The existing Docker Kaneo E2E suite remains during adoption. Once real-Kaneo-adapter
stories against the fake transport cover papai behavior, reduce Docker coverage to a
small provider-real contract and packaging tier rather than duplicating the entire
user-story matrix.

## Adoption sequence

1. On current master, characterize production startup and shutdown behavior.
2. On current master, extract the shared lifecycle-managed composition root without
   changing behavior.
3. Introduce deterministic runtime boundaries and strict I/O guards.
4. Build `ScenarioWorld`, the typed DSL, stable capability references, event
   recording, and diagnostics.
5. Implement the generic chat and task fakes plus scripted AI SDK model.
6. Add the chat-task, settings, context, permissions, plugin lifecycle, and coding
   session walking-skeleton stories.
7. Run and record the passing master baseline and scenario manifest.
8. Make the baseline suite a required CI job and add randomized stress execution.
9. Rebase or merge `plugin-core-separation` onto the baseline.
10. Move trusted-module loading behind the same `PapaiRuntime` contract and add
    symmetric cleanup for module ports, registries, and subscribers.
11. Run compatibility mode with the unchanged `tests/stories/**` tree and record the
    candidate proof.
12. Continue adding high-value cross-module regressions after the compatibility proof.

This order produces evidence on the architecture that exists today before asking the
refactoring track to preserve it. It avoids both a speculative master implementation
of trusted modules and a test suite that only ever passed on the target architecture.

## Consequences

### Positive

- User-visible behavior receives a deterministic full-stack regression layer.
- Production startup gains explicit lifecycle ownership and becomes easier to test.
- The refactor receives a reproducible before/after behavioral proof instead of tests
  written only against its target structure.
- External integrations can be tested deeply without network flakiness or service
  cost.
- Fresh per-scenario state prevents settings, context, and extension leakage.
- Typed scenarios remain readable and refactor-friendly.
- Failure traces show cross-component causality without requiring broad snapshots.

### Negative

- Extracting the composition root is meaningful architecture work before broad story
  coverage can land.
- Some existing globals, caches, and direct environment/time/I/O reads will need seams
  or ownership changes.
- In-memory service fakes require maintenance alongside external API adapters.
- The harness does not prove that a real third-party deployment remains compatible;
  the small provider-real tier still has value.
- The refactor cannot claim compatibility by rewriting affected scenarios; an
  intentional behavior change requires explicit product review outside the unchanged
  compatibility corpus.

### Risks and mitigations

- **Fake drift:** Validate each fake transport with focused real-adapter contract
  tests and keep a minimal provider-real smoke tier.
- **Harness becomes a second application:** The harness may compose and observe real
  components but must not duplicate authorization, context, tool, plugin, or trusted
  module logic.
- **Brittle stories:** Assert replies and durable invariants; avoid full prompt/event
  snapshots and incidental call counts.
- **Incomplete cleanup:** Centralize lifecycle ownership and make leak validation a
  required part of every scenario. A new extension tier cannot enter the runtime
  without symmetric activation and deactivation.
- **Capability mapping hides regressions:** Resolve each stable capability reference
  from the real assembled contribution metadata and fail on zero or multiple matches;
  keep concrete tool-name assertions in focused contract tests.
- **Candidate edits the tests:** Hash all of baseline `tests/stories/**` and fail the
  compatibility job before execution when any harness or scenario file differs.
- **False hermeticity confidence:** Document that guards are process-level JavaScript
  enforcement, optionally strengthened by an OS network namespace in Linux CI.
- **Slow suite growth:** Prefer contract fakes for the broad matrix, use real adapters
  only where serialization/integration fidelity is relevant, and shard by file.

## Success criteria

The harness is successful when:

- every initial walking-skeleton story runs without live services or developer
  credentials;
- repeating a scenario produces the same IDs, events, durable state, and reply;
- scenarios pass in any order and in parallel files;
- undeclared outbound access fails before reaching a real service;
- a scenario cannot observe state left by another scenario;
- production and tests build the application through the same composition root;
- failures identify the responsible boundary and recent causal events;
- the required PR job passes without retries;
- the walking-skeleton corpus passes on current master and produces a baseline
  manifest;
- `plugin-core-separation` passes compatibility mode with the identical
  `tests/stories/**` manifest hash;
- ACP's move from plugin to trusted coding module requires no changes under
  `tests/stories/**`;
- every extension activated by the candidate runtime is symmetrically cleaned up;
- a representative architecture refactor can change internal modules without
  rewriting behaviorally unchanged scenarios.

## References

- [Bazel Test Encyclopedia — hermetic test environment](https://bazel.build/reference/test-encyclopedia)
- [Bun test runner — lifecycle, randomization, seeds, and repeat execution](https://bun.sh/docs/test)
- [Bun module mocks and preloads](https://bun.sh/docs/test/mocks)
- [Bun dates and times — system time does not virtualize timers](https://bun.sh/docs/test/dates-times)
- [Vercel AI SDK Core testing — `MockLanguageModelV3`](https://ai-sdk.dev/docs/ai-sdk-core/testing)
- [Vercel AI SDK tool calling and multi-step execution](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [`docs/architecture/behaviors.md`](../../architecture/behaviors.md)
- [`docs/architecture/plugins.md`](../../architecture/plugins.md)
- [`docs/architecture/coding-sessions.md`](../../architecture/coding-sessions.md)
- [`docs/architecture/commands.md`](../../architecture/commands.md)
