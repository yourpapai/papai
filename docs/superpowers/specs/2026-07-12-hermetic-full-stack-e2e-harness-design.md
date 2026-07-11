<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Hermetic full-stack user-story E2E harness

**Status:** approved (brainstorm), pending implementation plan

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
   providers, plugins, clock, identifiers, and event history.
4. Fail immediately on undeclared network, process, socket, or filesystem activity.
5. Provide a small typed TypeScript DSL that expresses user intent and observable
   outcomes rather than internal implementation details.
6. Support real plugins and provider adapters against in-memory fake transports,
   including ACP against a fake magi service.
7. Produce actionable traces and leak reports when a story fails.
8. Remain useful as internal modules are refactored by keeping scenario inputs and
   assertions at stable behavioral boundaries.

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
  generic real-plugin/fake-transport boundary.
- Defining a YAML or JSON scenario language.

## Decision

Extract a lifecycle-managed papai composition root used by both production startup
and the test harness. Build a typed scenario DSL on top of that shared runtime. The
harness injects deterministic implementations at external boundaries while running
real routing, bot handling, settings routes, persistence, LLM orchestration, tool
assembly and execution, task-provider resolution, context rules, and plugin
lifecycle code.

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

## Runtime architecture

The shared composition root exposes a lifecycle rather than executing work during
module import:

```typescript
interface PapaiRuntime {
  start(): Promise<void>
  stop(): Promise<void>
  dispatch(message: IncomingMessage): Promise<void>
  request(request: Request): Promise<Response>
}
```

The runtime contract must preserve four properties:

1. construction has no externally visible startup side effects;
2. `start()` owns initialization and is safe to fail partway through;
3. `stop()` is idempotent and releases everything the runtime started;
4. normalized chat dispatch and fetch-style HTTP routing are available without a
   network listener.

`createPapaiRuntime(config, deps)` assembles the real application:

- SQLite initialization and configuration stores;
- platform and task-instance resolution;
- `ChatRouter` and `setupBot`;
- LLM orchestration and tool execution;
- settings, admin, debug, and plugin HTTP route dispatch;
- plugin discovery, approval, compatibility evaluation, activation, and deactivation;
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

The composition root should own mutable runtime services rather than relying on
process-global state. Existing unavoidable registries and caches must have explicit
scenario reset/leak contracts until they can become runtime-owned.

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
  plugin approvals/configuration, task state, and scripted LLM turns.
- `when` delivers chat messages/interactions, calls real settings routes using
  authenticated `Request` objects, advances the clock, or emits declared integration
  callbacks.
- `then` asserts replies, task state, context/history, permissions, settings, plugin
  records, and emitted integration requests.
- `world.inspect` is an escape hatch for diagnostics and uncommon assertions, not the
  normal authoring surface.

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

### Real adapter with fake transport

The real plugin or provider implementation runs, but its outbound HTTP calls route to
a deterministic in-memory service registered with `StrictFetchDispatcher`. This
level verifies request serialization, authentication, response mapping, registration,
and errors without a live service.

Kaneo and YouTrack compatibility stories activate their real task-provider plugins
against fake HTTP APIs. ACP stories activate the real ACP plugin against a fake magi
service. Future integrations, including nerv plugins, use the same pattern.

The fake magi service supports only endpoints required by declared stories and records
requests. It must cover session start, continuation, approval, cancellation,
completion, listing/status, failures, and notification-related flows as those stories
are added. ACP stories use real credential resolution, guardrails, group identity,
plugin history, and tool registration.

## Data flow

```text
scenario user
  -> in-process chat adapter
  -> real ChatRouter and bot
  -> real LLM orchestration
  -> scripted AI SDK model
  -> real tool assembly, permission gates, and execution
  -> real core service or plugin/provider adapter
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
8. verify that no pending model steps, requests, timers, listeners, servers, plugin
   activations, environment mutations, or filesystem artifacts escaped cleanup.

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
- recent chat, LLM, tool, provider, plugin, and settings events.

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
  plugins/
    acp/
  regression/
```

Scenarios carry typed metadata such as behavioral area, required plugins,
capabilities, and issue reference. Metadata supports selection and deterministic CI
sharding; it must not introduce behavior branches inside a story.

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
6. An ACP session starts through the real plugin and fake magi transport.
7. A disabled or incompatible plugin contributes no tools.
8. Undeclared network access and leaked runtime state produce actionable failures.

These stories intentionally span the main architectural seams. More scenarios are
added based on user-story risk and regressions, not to duplicate every unit-test case.

## CI strategy

- Add `bun test:stories` as a required pull-request job.
- Use deterministic sharding by scenario file for the normal PR path.
- Report scenario metadata and the deterministic seed in test output.
- Run a scheduled or pre-merge stress job with randomized order and repeated
  execution to reveal order dependence.
- Do not retry failures in required checks.
- Keep traces concise on success and attach the full sanitized trace only on failure.

The existing Docker Kaneo E2E suite remains during adoption. Once real-Kaneo-adapter
stories against the fake transport cover papai behavior, reduce Docker coverage to a
small provider-real contract and packaging tier rather than duplicating the entire
user-story matrix.

## Adoption sequence

1. Characterize current production startup and shutdown behavior.
2. Extract the shared lifecycle-managed composition root without changing behavior.
3. Introduce deterministic runtime boundaries and strict I/O guards.
4. Build `ScenarioWorld`, the typed DSL, event recording, and diagnostics.
5. Implement the generic chat and task fakes plus scripted AI SDK model.
6. Add the first chat-to-task walking-skeleton story.
7. Add settings, context, permissions, and plugin lifecycle stories.
8. Add real ACP plugin coverage against fake magi.
9. Make the suite a required CI job and add randomized stress execution.
10. Migrate high-value cross-module regressions as parallel refactors touch them.

This order gives the refactoring track an early vertical safety net while avoiding a
large up-front scenario catalog built on an unstable harness.

## Consequences

### Positive

- User-visible behavior receives a deterministic full-stack regression layer.
- Production startup gains explicit lifecycle ownership and becomes easier to test.
- External integrations can be tested deeply without network flakiness or service
  cost.
- Fresh per-scenario state prevents settings, context, and plugin leakage.
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

### Risks and mitigations

- **Fake drift:** Validate each fake transport with focused real-adapter contract
  tests and keep a minimal provider-real smoke tier.
- **Harness becomes a second application:** The harness may compose and observe real
  components but must not duplicate authorization, context, tool, or plugin logic.
- **Brittle stories:** Assert replies and durable invariants; avoid full prompt/event
  snapshots and incidental call counts.
- **Incomplete cleanup:** Centralize lifecycle ownership and make leak validation a
  required part of every scenario.
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
